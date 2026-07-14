import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, symlinkSync } from 'fs'
import net from 'net'
import {
  checkEnvHealth,
  detectProjectKind,
  probeTcp,
} from '../src/core/envHealthService.js'
import { makeTempRoot, initRepo } from './helpers.js'

// envHealthService 测试：用真实临时目录 + 真实 TCP 监听验证完整运行路径，
// 不 mock，确保 IPC 实际调用时不会再「点了没反应」。

describe('envHealthService', () => {
  let ctx
  // taskDir 模拟一个任务目录，其下放各项目子目录
  let taskDir

  beforeEach(() => {
    ctx = makeTempRoot()
    taskDir = join(ctx.root, 'TASK-1')
    mkdirSync(taskDir, { recursive: true })
  })
  afterEach(() => ctx.cleanup())

  describe('probeTcp', () => {
    it('returns true for a port with a listening server', async () => {
      // server 临时监听一个随机端口，验证 probeTcp 能探测到
      const server = net.createServer()
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      // port 为系统分配的实际监听端口
      const port = server.address().port
      const ok = await probeTcp('127.0.0.1', port, 1000)
      expect(ok).toBe(true)
      server.close()
    })

    it('returns false for an unused port', async () => {
      // 选一个几乎不可能有服务的高位端口
      const ok = await probeTcp('127.0.0.1', 59999, 500)
      expect(ok).toBe(false)
    })
  })

  describe('checkEnvHealth - deps', () => {
    it('flags error when node_modules is missing', async () => {
      // proj 为缺少 node_modules 的前端项目（仅有 package.json + lock）
      const proj = join(taskDir, 'projA')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'a',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)
      expect(result.deps.status).toBe('error')
      expect(result.deps.message).toContain('未安装依赖')
      expect(result.deps.fixes.length).toBeGreaterThan(0)
    })

    it('reports ok when node_modules and lock both present', async () => {
      const proj = join(taskDir, 'projB')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'b',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)
      expect(result.deps.status).toBe('ok')
    })

    it('reports ok when frontend node_modules is a symlink entry', async () => {
      // proj 为 worktree 前端项目，node_modules 由源项目软链接复用，不应按普通缺失依赖报错。
      const proj = join(taskDir, 'proj-linked')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'linked',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      // missingTarget 存储一个暂不存在的源依赖目录，复现 existsSync 跟随断链软链接导致误判缺失的场景。
      const missingTarget = join(ctx.root, 'shared-node-modules-missing')
      symlinkSync(missingTarget, join(proj, 'node_modules'), 'dir')

      // result 存储环境检查结果，用于验证软链接入口不会被当成缺失依赖。
      const result = await checkEnvHealth(taskDir)

      expect(result.summary.status).toBe('ok')
      expect(result.deps.status).toBe('ok')
      expect(result.projects[0].checks.deps.message).toContain('依赖完整')
    })
  })

  describe('detectProjectKind', () => {
    it('identifies frontend projects from package scripts and dependencies', () => {
      // proj 为典型 Vite/React 前端项目，用于验证无需用户配置也能识别前端类型
      const proj = join(taskDir, 'frontend-app')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'frontend-app',
          scripts: { dev: 'vite --port 5173', build: 'vite build' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'index.html'), '<div id="root"></div>')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('frontend')
      expect(result.label).toBe('前端')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.reasons.join(' ')).toContain('vite')
    })

    it('identifies backend projects from server dependencies', () => {
      // proj 为典型 Node 后端项目，用于验证后端无需手动角色配置即可识别
      const proj = join(taskDir, 'api-server')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'api-server',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0', prisma: '^5.0.0' },
        })
      )

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('backend')
      expect(result.label).toBe('后端')
      expect(result.reasons.join(' ')).toContain('express')
    })

    it('identifies PHP backend projects from composer and ThinkPHP files', () => {
      // proj 为典型 PHP/ThinkPHP 后端项目，用于验证没有 package.json 时也不会落到 unknown。
      const proj = join(taskDir, 'logistics')
      mkdirSync(join(proj, 'ThinkPHP'), { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: { php: '>=7.4' } })
      )
      writeFileSync(join(proj, 'index.php'), '<?php echo "ok";')
      writeFileSync(join(proj, 'ThinkPHP/ThinkPHP.php'), '<?php')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('backend_php')
      expect(result.label).toBe('PHP 后端')
      expect(result.reasons.join(' ')).toContain('composer.json')
    })

    it('identifies Java backend projects from Maven or Gradle files', () => {
      // proj 为典型 Java 后端项目，用 Maven 构建文件作为识别依据。
      const proj = join(taskDir, 'java-api')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'pom.xml'), '<project />')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('backend_java')
      expect(result.label).toBe('Java 后端')
    })

    it('identifies Python backend projects from dependency files', () => {
      // proj 为典型 Python 后端项目，用 requirements.txt 作为识别依据。
      const proj = join(taskDir, 'python-api')
      mkdirSync(proj, { recursive: true })
      writeFileSync(join(proj, 'requirements.txt'), 'fastapi==0.1.0\n')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('backend_python')
      expect(result.label).toBe('Python 后端')
    })

    it('identifies frontend pc web as frontend instead of fullstack', () => {
      // proj 复现 web-app：webpack-dev-server 前面带 node 参数，但它仍是前端构建脚本，不应被识别为后端
      const proj = join(taskDir, 'web-app')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'web-app',
          scripts: {
            dev: 'cross-env NODE_ENV=development node --max_old_space_size=4096 node_modules/.bin/webpack-dev-server --config ./build/webpack.config.js --progress',
            test: 'vitest run',
          },
          dependencies: { react: '17.0.2', 'react-dom': '17.0.2' },
          devDependencies: {
            webpack: '^5.72.1',
            'webpack-dev-server': '^4.9.0',
          },
        })
      )

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('frontend')
      expect(result.label).toBe('前端')
      expect(result.reasons.join(' ')).not.toContain('后端脚本 node')
    })

    it('identifies frontend hybrid mobile as miniprogram', () => {
      // proj 复现 hybrid-mobile：目录名是业务约定的小程序仓库名，即使内部用 Vue CLI 构建也应展示为小程序
      const proj = join(taskDir, 'hybrid-mobile')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'mobile_end',
          scripts: {
            dev: 'vue-cli-service serve',
            router: 'node ./build-app/router.js',
            build: 'vue-cli-service build --mode ${ENV}',
          },
          dependencies: { vue: '^2.6.10' },
          devDependencies: { '@vue/cli-service': '^3.6.0', webpack: '^4.0.0' },
        })
      )
      mkdirSync(join(proj, 'src'), { recursive: true })
      writeFileSync(join(proj, 'src/main.js'), 'import Vue from "vue";')

      const result = detectProjectKind(proj)

      expect(result.kind).toBe('miniprogram')
      expect(result.label).toBe('小程序')
      expect(result.reasons.join(' ')).toContain('hybrid-mobile')
    })
  })

  describe('checkEnvHealth - project summary', () => {
    it('ignores the default root docs work document directory during project checks', async () => {
      // docsDir 模拟任务根目录下的默认工作文档目录，它用于放文档，不是前后端项目。
      const docsDir = join(taskDir, 'docs')
      mkdirSync(docsDir, { recursive: true })
      writeFileSync(
        join(docsDir, 'package.json'),
        JSON.stringify({ name: 'docs', scripts: {} })
      )
      writeFileSync(join(docsDir, 'package-lock.json'), '{}')

      // proj 为真实前端项目，环境完整时应成为本次检查唯一项目。
      const proj = join(taskDir, 'web')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite --port 5173' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'index.html'), '<div id="root"></div>')

      const result = await checkEnvHealth(taskDir)
      // projectNames 存储环境检查实际纳入的项目名，用于证明 docs 被排除。
      const projectNames = result.projects.map((project) => project.name)

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(1)
      expect(projectNames).toEqual(['web'])
      expect(result.deps.status).toBe('ok')
    })

    it('ignores custom root work document directories from config templates', async () => {
      // notesDir 模拟用户自定义的工作文档目录，它即使存在 package.json 也不应被当作项目检查。
      const notesDir = join(taskDir, 'notes')
      mkdirSync(notesDir, { recursive: true })
      writeFileSync(
        join(notesDir, 'package.json'),
        JSON.stringify({ name: 'notes', scripts: {} })
      )
      writeFileSync(join(notesDir, 'package-lock.json'), '{}')

      // proj 为真实后端项目，环境完整时应成为本次检查唯一项目。
      const proj = join(taskDir, 'api')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'api',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      // templates 存储用户配置的工作文档模板，环境检查应按这份配置排除根级 notes。
      const templates = [{ type: 'directory', path: 'notes', content: '' }]
      const result = await checkEnvHealth(taskDir, [], {
        workDocumentTemplates: templates,
      })
      // projectNames 存储环境检查实际纳入的项目名，用于证明自定义工作文档目录被排除。
      const projectNames = result.projects.map((project) => project.name)

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(1)
      expect(projectNames).toEqual(['api'])
      expect(result.deps.status).toBe('ok')
    })

    it('ignores unknown non frontend/backend project directories during project checks', async () => {
      // superpowersDir 模拟任务根目录下的非业务项目目录；它有 package.json 但不是前端/后端项目。
      const superpowersDir = join(taskDir, 'superpowers')
      mkdirSync(superpowersDir, { recursive: true })
      writeFileSync(
        join(superpowersDir, 'package.json'),
        JSON.stringify({
          name: 'superpowers',
          scripts: { test: 'node tests/run.js' },
        })
      )
      writeFileSync(join(superpowersDir, 'package-lock.json'), '{}')

      // proj 为真实前端项目，环境完整时应成为本次检查唯一项目。
      const proj = join(taskDir, 'web')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite --port 5173' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'index.html'), '<div id="root"></div>')

      const result = await checkEnvHealth(taskDir)
      // projectNames 存储环境检查实际纳入的项目名，用于证明 unknown 目录被排除。
      const projectNames = result.projects.map((project) => project.name)

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(1)
      expect(projectNames).toEqual(['web'])
      expect(result.deps.status).toBe('ok')
    })

    it('treats tasks with only unknown directories as no environment issue', async () => {
      // superpowersDir 模拟任务中唯一的非业务工具目录；缺少 node_modules 也不应变成环境错误。
      const superpowersDir = join(taskDir, 'superpowers')
      mkdirSync(superpowersDir, { recursive: true })
      writeFileSync(
        join(superpowersDir, 'package.json'),
        JSON.stringify({
          name: 'superpowers',
          scripts: { test: 'node tests/run.js' },
        })
      )
      writeFileSync(join(superpowersDir, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(0)
      expect(result.summary.issueCount).toBe(0)
      expect(result.projects).toEqual([])
      expect(result.deps.status).toBe('ok')
    })

    it('checks PHP backend dependencies without Node package checks', async () => {
      // proj 为 PHP 后端项目，vendor 与 composer.lock 齐备时依赖检查应正常，且端口检查不再提示 package.json。
      const proj = join(taskDir, 'logistics')
      mkdirSync(join(proj, 'vendor'), { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: { php: '>=7.4' } })
      )
      writeFileSync(join(proj, 'composer.lock'), '{}')
      writeFileSync(join(proj, 'index.php'), '<?php echo "ok";')

      const result = await checkEnvHealth(taskDir)
      // project 存储 PHP 后端项目的检查详情，用于验证它被纳入环境检查。
      const project = result.projects[0]

      expect(result.summary.status).toBe('ok')
      expect(project.kind).toBe('backend_php')
      expect(project.kindLabel).toBe('PHP 后端')
      expect(project.checks.deps.message).toContain('PHP 依赖完整')
      expect(project.checks.ports.message).not.toContain('package.json')
      expect(result.deps.status).toBe('ok')
    })

    it('skips local PHP vendor checks when Docker runtime config is present', async () => {
      // proj 为 Docker 启动的 PHP 后端，依赖可能在镜像或容器启动阶段安装，本机 worktree 不应因缺 vendor 报红。
      const proj = join(taskDir, 'logistics-docker')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'composer.json'),
        JSON.stringify({ require: { php: '>=7.4' } })
      )
      writeFileSync(join(proj, 'index.php'), '<?php echo "ok";')
      writeFileSync(
        join(proj, 'docker-compose.yml'),
        'services:\n  php:\n    image: php:8.2-cli\n'
      )

      // result 存储环境检查结果，用于验证 Docker 场景不会因本机缺 vendor 报错。
      const result = await checkEnvHealth(taskDir)
      // project 存储 Docker 化 PHP 项目的检查详情，用于验证 vendor 缺失不再进入问题列表。
      const project = result.projects[0]

      expect(result.summary.status).toBe('ok')
      expect(result.deps.status).toBe('ok')
      expect(project.kind).toBe('backend_php')
      expect(project.checks.deps.status).toBe('ok')
      expect(project.checks.deps.message).toContain('Docker')
      expect(project.issues).toEqual([])
    })

    it('returns project-level kind, checks and ok summary for healthy frontend worktrees', async () => {
      // proj 为健康前端项目：依赖目录与 lock 都存在，端口空闲，整体应为 ok
      const proj = join(taskDir, 'web')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'web',
          scripts: { dev: 'vite --port 5173' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'index.html'), '<div id="root"></div>')

      const result = await checkEnvHealth(taskDir)

      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(1)
      expect(result.summary.issueCount).toBe(0)
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0]).toMatchObject({
        name: 'web',
        kind: 'frontend',
        kindLabel: '前端',
        status: 'ok',
        issueCount: 0,
      })
      expect(result.projects[0].checks.deps.status).toBe('ok')
    })

    it('marks task summary failed when an auto-detected backend project has environment issues', async () => {
      // proj 缺少 node_modules：自动识别为后端后，应把任务级状态聚合为 failed 供 UI 显示红色
      const proj = join(taskDir, 'api')
      mkdirSync(proj, { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'api',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0', prisma: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)

      expect(result.summary.status).toBe('failed')
      expect(result.summary.issueCount).toBeGreaterThan(0)
      expect(result.summary.failedProjects).toEqual(['api'])
      expect(result.projects[0].kind).toBe('backend')
      expect(result.projects[0].status).toBe('failed')
      expect(result.projects[0].issues[0].message).toContain('未安装依赖')
      expect(result.deps.status).toBe('error')
    })
  })

  describe('checkEnvHealth - ports', () => {
    it('detects an occupied port declared in scripts', async () => {
      // server 占住一个端口，再把该端口写进项目 dev script，验证能检出占用
      const server = net.createServer()
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port

      const proj = join(taskDir, 'projC')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({ name: 'c', scripts: { dev: `vite --port ${port}` } })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)
      expect(result.ports.status).toBe('warning')
      expect(result.ports.message).toContain(String(port))
      server.close()
    })
  })

  describe('checkEnvHealth - git', () => {
    it('reports uncommitted changes without counting them as environment issues', async () => {
      // proj 为有未提交改动的 git 仓库
      const proj = initRepo(join(taskDir, 'projD'), 'master')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'projD',
          scripts: { start: 'node server.js' },
          dependencies: { express: '^4.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')
      writeFileSync(join(proj, 'dirty.txt'), 'x')

      const result = await checkEnvHealth(taskDir)
      expect(result.git.status).toBe('warning')
      expect(result.git.message).toContain('未提交')
      expect(result.projects[0].checks.git.status).toBe('warning')
      expect(result.projects[0].status).toBe('ok')
      expect(result.projects[0].issueCount).toBe(0)
      expect(result.summary.status).toBe('ok')
      expect(result.summary.issueCount).toBe(0)
    })
  })

  describe('checkEnvHealth - edge cases', () => {
    it('returns ok summary when task dir has no projects', async () => {
      // emptyDir 为空任务目录
      const emptyDir = join(ctx.root, 'EMPTY')
      mkdirSync(emptyDir, { recursive: true })
      const result = await checkEnvHealth(emptyDir)
      expect(result.deps.status).toBe('ok')
      expect(result.ports).toBeTruthy()
      expect(result.services).toBeTruthy()
      expect(result.git).toBeTruthy()
      expect(result.projects).toEqual([])
      expect(result.summary.status).toBe('ok')
      expect(result.summary.projectCount).toBe(0)
      expect(result.summary.issueCount).toBe(0)
      expect(result.summary.message).toBe('任务目录下未找到项目')
    })

    it('always returns all four check keys', async () => {
      const proj = join(taskDir, 'projE')
      mkdirSync(join(proj, 'node_modules'), { recursive: true })
      writeFileSync(
        join(proj, 'package.json'),
        JSON.stringify({
          name: 'e',
          scripts: { dev: 'vite' },
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        })
      )
      writeFileSync(join(proj, 'package-lock.json'), '{}')

      const result = await checkEnvHealth(taskDir)
      expect(Object.keys(result).sort()).toEqual([
        'deps',
        'git',
        'ports',
        'projects',
        'services',
        'summary',
      ])
      for (const key of ['deps', 'git', 'ports', 'services']) {
        expect(['ok', 'warning', 'error']).toContain(result[key].status)
        expect(typeof result[key].message).toBe('string')
      }
    })
  })
})
