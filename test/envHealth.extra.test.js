import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, symlinkSync } from 'fs'
import net from 'net'
import {
  checkEnvHealth,
  detectProjectKind,
  probeTcp,
} from '../src/core/envHealthService.js'
import { makeTempRoot, makeRemoteAndClone, commitFile, git } from './helpers.js'

// envHealthService 补充测试：针对未覆盖分支（各语言后端依赖检查、端口/服务提取、
// git ahead/behind、角色分组、readJson 降级、目录扫描边界）用真实临时目录验证。

describe('envHealthService - 补充覆盖', () => {
  // ctx 存储本次用例的临时根目录及清理函数
  let ctx
  // taskDir 存储模拟任务目录，其下每个子目录是一个项目
  let taskDir

  beforeEach(() => {
    ctx = makeTempRoot()
    taskDir = join(ctx.root, 'TASK-EXTRA')
    mkdirSync(taskDir, { recursive: true })
  })
  afterEach(() => ctx.cleanup())

  describe('probeTcp 边界', () => {
    it('非法端口触发同步异常时返回 false', async () => {
      // 端口超出合法范围会让 socket.connect 同步抛错，走 catch 分支
      const ok = await probeTcp('127.0.0.1', 999999, 200)
      expect(ok).toBe(false)
    })
  })

  describe('detectProjectKind 边界', () => {
    it('package.json 内容损坏时按空对象降级识别', () => {
      // proj 为 package.json 无法解析但有 index.html 的项目，验证 readJson 返回 null 后仍走前端识别
      const proj = join(taskDir, 'broken-pkg')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'package.json'), '{ not valid json')
      writeFileSync(join(proj, 'index.html'), '<div id="root"></div>')

      const result = detectProjectKind(proj)

      // 依赖/脚本读不到，但 index.html 命中前端文件特征
      expect(result.kind).toBe('frontend')
      expect(result.reasons.join(' ')).toContain('index.html')
    })

    it('无任何特征的目录识别为 unknown 且给出兜底说明', () => {
      // proj 为空目录，不含任何前后端特征
      const proj = join(taskDir, 'empty-proj')
      mkdirSync(proj, { recursive: true })

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('unknown')
      expect(result.label).toBe('未知')
      expect(result.confidence).toBe(0)
      expect(result.reasons[0]).toContain('跳过环境检查')
    })

    it('同时命中前后端特征时识别为全栈', () => {
      // proj 同时含前端依赖与后端依赖，且不属于具体语言后端，应聚合为 fullstack
      const proj = join(taskDir, 'fullstack-app')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'fullstack-app',
          scripts: { dev: 'vite', start: 'node server.js' },
          dependencies: { react: '^18.0.0', express: '^4.0.0' },
        })
      )

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('fullstack')
      expect(result.label).toBe('全栈')
    })

    it('同时命中多个具体语言后端时按分数选最高者', () => {
      // proj 同时含 PHP 与 Python 文件特征，验证 typedBackend 候选排序分支被执行
      const proj = join(taskDir, 'multi-backend')
      mkdirSync(proj, { recursive: true })
      // PHP 命中两处文件：composer.json + index.php，分数更高
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: {} })
      )
      writeFileSync(join(proj, 'index.php'), '<?php')
      // Python 只命中一处：requirements.txt
      writeFileSync(join(proj, 'requirements.txt'), 'flask\n')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('backend_php')
    })
  })

  describe('依赖检查 - 各语言分支', () => {
    it('Node 前端有依赖但缺 lock 文件时给出 warning', async () => {
      // proj 为有 node_modules 但无任何 lock 文件的前端项目，命中「依赖版本不确定」分支
      const proj = join(taskDir, 'no-lock')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'no-lock',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(proj, 'index.html'), '<div></div>')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.status).toBe('warning')
      expect(result.projects[0].checks.deps.message).toContain('缺少 lock')
    })

    it('Node 项目缺 node_modules 且存在 pnpm-lock 时推荐 pnpm install', async () => {
      // proj 为仅有 pnpm-lock.yaml 的前端项目，验证安装命令按锁文件类型推荐 pnpm
      const proj = join(taskDir, 'pnpm-proj')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'pnpm-proj',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(proj, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      writeFileSync(join(proj, 'index.html'), '<div></div>')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.status).toBe('error')
      expect(result.projects[0].checks.deps.fixes.join(' ')).toContain(
        'pnpm install'
      )
    })

    it('Node 项目缺 node_modules 且存在 yarn.lock 时推荐 yarn install', async () => {
      // proj 为仅有 yarn.lock 的前端项目，验证安装命令按锁文件类型推荐 yarn
      const proj = join(taskDir, 'yarn-proj')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'yarn-proj',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(proj, 'yarn.lock'), '# yarn lockfile v1\n')
      writeFileSync(join(proj, 'index.html'), '<div></div>')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.fixes.join(' ')).toContain(
        'yarn install'
      )
    })

    it('PHP 项目有 vendor 但缺 composer.lock 时给出 warning', async () => {
      // proj 为 vendor 齐备但缺锁文件的 PHP 项目，命中依赖版本不确定分支
      const proj = join(taskDir, 'php-no-lock')
      mkdirSync(join(proj, 'vendor'), { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: { php: '>=7.4' } })
      )
      writeFileSync(join(proj, 'index.php'), '<?php')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.status).toBe('warning')
      expect(result.projects[0].checks.deps.message).toContain('composer.lock')
    })

    it('PHP 项目缺 vendor 且无 Docker 配置时报 error', async () => {
      // proj 为无 vendor、无 Docker 的 PHP 项目，命中「未安装 PHP 依赖」错误分支
      const proj = join(taskDir, 'php-missing')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: { php: '>=7.4' } })
      )
      writeFileSync(join(proj, 'index.php'), '<?php')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.status).toBe('error')
      expect(result.projects[0].checks.deps.message).toContain('缺少 vendor')
    })

    it('Java 项目有构建文件时跳过本地依赖目录检查', async () => {
      // proj 为含 pom.xml 的 Java 项目，验证依赖检查走「Maven/Gradle 缓存管理」跳过分支
      const proj = join(taskDir, 'java-proj')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'pom.xml'), '<project />')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].kind).toBe('backend_java')
      expect(result.projects[0].checks.deps.status).toBe('ok')
      expect(result.projects[0].checks.deps.message).toContain('Maven/Gradle')
    })

    // 说明：checkJavaProjectDeps 缺构建文件的 warning 分支实际不可达——
    // detectProjectKind 识别为 backend_java 必须命中 JAVA_BACKEND_FILE_HINTS 之一，
    // 而该函数用同一组常量判断构建文件是否存在，因此识别成 Java 时构建文件必然存在，故不测。

    it('Python 项目有依赖声明但缺虚拟环境时给出 warning', async () => {
      // proj 为含 requirements.txt 但无 .venv 的 Python 项目，命中缺虚拟环境 warning
      const proj = join(taskDir, 'py-no-venv')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'requirements.txt'), 'fastapi==0.1.0\n')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].kind).toBe('backend_python')
      expect(result.projects[0].checks.deps.status).toBe('warning')
      expect(result.projects[0].checks.deps.message).toContain('虚拟环境')
    })

    it('Python 项目有虚拟环境时依赖检查通过', async () => {
      // proj 为含 requirements.txt 且有 .venv 的 Python 项目，命中依赖环境已准备分支
      const proj = join(taskDir, 'py-with-venv')
      mkdirSync(join(proj, '.venv'), { recursive: true })
      writeFileSync(join(proj, 'requirements.txt'), 'fastapi==0.1.0\n')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.deps.status).toBe('ok')
      expect(result.projects[0].checks.deps.message).toContain('虚拟环境存在')
    })

    it('Python 项目仅有简化入口无依赖声明时跳过依赖检查', async () => {
      // proj 依靠 main.py 识别为 Python，但无 requirements/pyproject/Pipfile，命中跳过依赖检查分支
      const proj = join(taskDir, 'py-entry-only')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'main.py'), 'print("ok")\n')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].kind).toBe('backend_python')
      expect(result.projects[0].checks.deps.status).toBe('ok')
      expect(result.projects[0].checks.deps.message).toContain('跳过依赖检查')
    })
  })

  describe('端口检查 - 非 Node 项目与解析失败', () => {
    it('从 PHP 项目 .env 中提取端口并检测占用', async () => {
      // server 占住一个端口，写进 PHP 项目的 .env，验证非 Node 项目走配置文件端口提取路径
      const server = net.createServer()
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      // port 为系统分配的实际监听端口
      const port = server.address().port

      const proj = join(taskDir, 'php-ports')
      mkdirSync(join(proj, 'vendor'), { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: {} })
      )
      writeFileSync(join(proj, 'composer.lock'), '{}')
      writeFileSync(join(proj, 'index.php'), '<?php')
      // .env 用 PORT=xxx 形式声明端口，命中 extractPorts 的 PORT 正则
      writeFileSync(join(proj, '.env'), `PORT=${port}\n`)

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.ports.status).toBe('warning')
      expect(result.projects[0].checks.ports.message).toContain(String(port))
      server.close()
    })

    it('非 Node 项目无端口声明时端口检查跳过', async () => {
      // proj 为无任何端口配置的 PHP 项目，命中「未发现端口声明」跳过分支
      const proj = join(taskDir, 'php-no-ports')
      mkdirSync(join(proj, 'vendor'), { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: {} })
      )
      writeFileSync(join(proj, 'composer.lock'), '{}')
      writeFileSync(join(proj, 'index.php'), '<?php')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.ports.message).toContain(
        '未发现端口声明'
      )
    })

    it('Node 项目 package.json 解析失败时端口检查降级为 warning', async () => {
      // proj 有 index.html 保证被识别为前端，但 package.json 内容损坏，读取 scripts 时抛错走 warning 分支
      const proj = join(taskDir, 'bad-pkg-ports')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'index.html'), '<div></div>')
      // 先写合法 package.json 让识别为前端，再破坏它——但 detectProjectKind 也会解析失败。
      // 用只含 index.html 的方式识别前端，package.json 损坏触发端口解析 catch。
      writeFileSync(join(proj, 'package.json'), '{ broken')

      const result = await checkEnvHealth(taskDir)

      // 识别为前端（index.html 命中），checkProjectPorts 解析 package.json 失败返回 warning
      expect(result.projects[0].kind).toBe('frontend')
      expect(result.projects[0].checks.ports.status).toBe('warning')
      expect(result.projects[0].checks.ports.message).toContain(
        'package.json 解析失败'
      )
    })
  })

  describe('服务连通性检查', () => {
    it('.env 声明的服务地址不可达时报 error', async () => {
      // proj 的 .env 指向一个几乎不可能有服务的高位端口，验证 TCP 探测失败走 error 分支
      const proj = join(taskDir, 'svc-unreachable')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'svc',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      // DATABASE_URL 用连接串形式，命中 URL 正则；端口选高位不可达
      writeFileSync(
        join(proj, '.env'),
        'DATABASE_URL=postgres://user:pass@127.0.0.1:59998/db\n'
      )

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.services.status).toBe('error')
      expect(result.projects[0].checks.services.message).toContain('服务不可达')
    })

    it('.env 声明的服务可达时服务检查通过', async () => {
      // server 监听端口，.env 以 host:port 裸地址形式声明，验证可达分支与裸地址正则
      const server = net.createServer()
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port

      const proj = join(taskDir, 'svc-ok')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'svc-ok',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, '.env'), `REDIS_ADDR=127.0.0.1:${port}\n`)

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.services.status).toBe('ok')
      expect(result.projects[0].checks.services.message).toContain('服务可达')
      server.close()
    })

    it('.env 存在但无 host:port 形式地址时服务检查跳过', async () => {
      // proj 的 .env 只含普通键值，不含可探测地址，命中「未发现 host:port」分支
      const proj = join(taskDir, 'svc-no-endpoint')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'x',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      // .env 含注释行、空行、无等号行与无值行，覆盖 extractEnvEndpoints 的跳过分支
      writeFileSync(
        join(proj, '.env'),
        '# comment\n\nNAKED_LINE\nAPP_NAME=demo\nEMPTY=\n'
      )

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.services.message).toContain(
        '未发现 host:port'
      )
    })
  })

  describe('Git 状态检查 - ahead/behind 与异常', () => {
    it('本地领先远程时 git 检查提示领先', async () => {
      // 构造 remote+clone，本地多提交一次不推送，产生 ahead
      const pair = makeRemoteAndClone(join(ctx.root, 'ahead-base'), 'master')
      // 把 local 克隆搬进任务目录作为项目
      const proj = join(taskDir, 'ahead-proj')
      git(ctx.root, `clone -q ${pair.remote} ${proj}`)
      git(proj, 'config commit.gpgsign false')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'ahead',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      // 本地新增一次提交但不 push，制造领先远程
      commitFile(proj, 'local-only.txt', 'x', 'local commit')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.git.status).toBe('warning')
      expect(result.projects[0].checks.git.message).toContain('领先远程')
    })

    it('本地落后远程时 git 检查提示落后并建议 pull', async () => {
      // 构造 remote+clone，remote 端再推一次提交后本地 fetch，使本地落后
      const pair = makeRemoteAndClone(join(ctx.root, 'behind-base'), 'master')
      const proj = join(taskDir, 'behind-proj')
      git(ctx.root, `clone -q ${pair.remote} ${proj}`)
      git(proj, 'config commit.gpgsign false')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'behind',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      // 在 seed 工作区推一次新提交到 remote，再让 proj fetch，制造落后远程
      commitFile(pair.seed, 'remote-new.txt', 'y', 'remote commit')
      git(pair.seed, 'push -q origin master')
      git(proj, 'fetch -q origin')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.git.status).toBe('warning')
      expect(result.projects[0].checks.git.message).toContain('落后远程')
      expect(result.projects[0].checks.git.fixes.join(' ')).toContain(
        'git pull'
      )
    })

    it('.git 损坏导致状态读取失败时降级为 warning', async () => {
      // proj 有 index.html 识别为前端，.git 写成非法内容让 simple-git status 抛错，走 catch 分支
      const proj = join(taskDir, 'broken-git')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'index.html'), '<div></div>')
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'bg',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      // .git 写成指向不存在目录的 gitdir 文件，使 simpleGit.status() 失败
      writeFileSync(join(proj, '.git'), 'gitdir: /nonexistent/path/.git\n')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects[0].checks.git.status).toBe('warning')
      expect(result.projects[0].checks.git.message).toContain(
        'git 状态检查失败'
      )
    })
  })

  describe('角色分组 byRole', () => {
    it('配置有效角色时按角色目录分别检查并返回 byRole', async () => {
      // 任务下两个项目分属前端/后端角色，验证 pickDirsForRole + checkDirs 分组路径
      const web = join(taskDir, 'web')
      mkdirSync(join(web, 'node_modules'), { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(web, 'package-lock.json'), '{}')
      writeFileSync(join(web, 'index.html'), '<div></div>')

      const api = join(taskDir, 'api')
      mkdirSync(join(api, 'node_modules'), { recursive: true })
      writeFileSync(
        join(api, 'package.json'),
        JSON.stringify({
          name: 'api',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(api, 'package-lock.json'), '{}')

      // roles 声明两个角色，各命中一个子目录
      const roles = [
        { name: '前端', dirs: ['web'] },
        { name: '后端', dirs: ['api'] },
      ]
      const result = await checkEnvHealth(taskDir, roles)

      expect(Array.isArray(result.byRole)).toBe(true)
      expect(result.byRole).toHaveLength(2)
      expect(result.byRole[0].name).toBe('前端')
      expect(result.byRole[0].deps.status).toBe('ok')
      expect(result.byRole[1].name).toBe('后端')
    })

    it('角色声明的目录都不存在时给出未找到目录提示', async () => {
      // 任务下仅有 web，但角色声明的目录名不存在，命中 miss 提示分支
      const web = join(taskDir, 'web')
      mkdirSync(join(web, 'node_modules'), { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(web, 'package-lock.json'), '{}')
      writeFileSync(join(web, 'index.html'), '<div></div>')

      const roles = [{ name: '后端', dirs: ['nonexistent-dir'] }]
      const result = await checkEnvHealth(taskDir, roles)

      expect(result.byRole).toHaveLength(1)
      expect(result.byRole[0].deps.status).toBe('warning')
      expect(result.byRole[0].deps.message).toContain('未找到该角色的目录')
    })
  })

  describe('checkEnvHealth 目录边界', () => {
    it('任务目录不存在时返回空项目 ok 结果', async () => {
      // 传入不存在的路径，listProjectDirs 提前返回空，命中无项目分支
      const result = await checkEnvHealth(join(ctx.root, 'no-such-dir'))

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(0)
      expect(result.projects).toEqual([])
    })

    it('扫描时跳过隐藏目录', async () => {
      // 任务目录下放一个隐藏目录（.hidden）和一个真实项目，验证隐藏项被跳过
      const hidden = join(taskDir, '.hidden')
      mkdirSync(hidden, { recursive: true })
      writeFileSync(
        join(hidden, 'package.json'),
        JSON.stringify({ name: 'h', dependencies: { react: '^18.0.0' } })
      )

      const web = join(taskDir, 'web')
      mkdirSync(join(web, 'node_modules'), { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(web, 'package-lock.json'), '{}')
      writeFileSync(join(web, 'index.html'), '<div></div>')

      const result = await checkEnvHealth(taskDir)
      // projectNames 存储实际纳入检查的项目名，用于验证隐藏目录未被扫描
      const projectNames = result.projects.map((p) => p.name)

      expect(projectNames).toEqual(['web'])
    })

    it('扫描遇到断链软链接项时跳过该项继续', async () => {
      // brokenLink 是指向不存在目标的软链接，statSync 会抛错，验证 listProjectDirs 的 catch 分支
      const brokenLink = join(taskDir, 'broken-link')
      symlinkSync(join(ctx.root, 'nowhere-target'), brokenLink, 'dir')

      const web = join(taskDir, 'web')
      mkdirSync(join(web, 'node_modules'), { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
        })
      )
      writeFileSync(join(web, 'package-lock.json'), '{}')
      writeFileSync(join(web, 'index.html'), '<div></div>')

      const result = await checkEnvHealth(taskDir)

      expect(result.projects.map((p) => p.name)).toEqual(['web'])
    })
  })
})
