/**
 * 宿主与客户端的一致性测试。
 *
 * 客户端 bundle 不能 import 宿主模块（它是自包含的手写 factory），所以格式表与
 * 路由常量在两边各有一份。**两份必须逐字一致**：宿主按自己的表决定响应
 * Content-Type 与后缀白名单，客户端按自己的表决定注册哪些后缀、选 video 还是
 * audio。任何一边漏改，症状都是"文件认领了却播不了"这种最难查的错。
 *
 * 因此这里不比对"是否有重复代码"，而是直接解析客户端源码里的字面量来对账。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AUDIO_MIME, VIDEO_MIME } from '../lib/media-formats.mjs'
import { INDEX_ROUTE, STREAM_ROUTE } from '../lib/index.js'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const clientSource = readFileSync(CLIENT_PATH, 'utf8')

/**
 * 从客户端源码里抠出一个对象字面量并求值。
 *
 * @param marker - `const X = {` 里的 X。
 * @returns 求值后的对象。
 */
function objectLiteral(marker) {
  const start = clientSource.indexOf(`const ${marker} = {`)
  assert.notEqual(start, -1, `客户端缺少 ${marker}`)
  const open = clientSource.indexOf('{', start)
  const close = clientSource.indexOf('\n      }', open)
  assert.notEqual(close, -1, `${marker} 字面量没有找到结束位置`)
  const literal = clientSource.slice(open, close + 8)
  // eslint-disable-next-line no-new-func
  return new Function('return ' + literal)()
}

/**
 * 从客户端源码里抠出一个字符串常量。
 *
 * @param marker - 常量名。
 * @returns 字符串值。
 */
function stringLiteral(marker) {
  const match = new RegExp(`const ${marker} = '([^']*)'`).exec(clientSource)
  assert.ok(match, `客户端缺少 ${marker}`)
  return match[1]
}

test('视频格式表两边一致', () => {
  assert.deepEqual(objectLiteral('VIDEO_MIME'), VIDEO_MIME)
})

test('音频格式表两边一致', () => {
  assert.deepEqual(objectLiteral('AUDIO_MIME'), AUDIO_MIME)
})

test('注册的后缀顺序两边一致（VIDEO 在前，AUDIO 在后）', () => {
  const clientVideo = Object.keys(objectLiteral('VIDEO_MIME'))
  const clientAudio = Object.keys(objectLiteral('AUDIO_MIME'))
  assert.deepEqual(clientVideo, Object.keys(VIDEO_MIME))
  assert.deepEqual(clientAudio, Object.keys(AUDIO_MIME))
  // 宿主侧没有"合并列表"这个概念（路由按 MIME 表查），但客户端声明给
  // documentPreviews 的顺序必须正好是 video 段 + audio 段。
  assert.deepEqual(clientVideo.concat(clientAudio), [
    ...Object.keys(VIDEO_MIME),
    ...Object.keys(AUDIO_MIME),
  ])
})

test('流式路由与清单路由的路径两边一致', () => {
  assert.equal(stringLiteral('STREAM_ROUTE'), 'api/media')
  assert.equal('/' + stringLiteral('STREAM_ROUTE'), STREAM_ROUTE)
  assert.equal(stringLiteral('INDEX_ROUTE'), 'api/media-index')
  assert.equal('/' + stringLiteral('INDEX_ROUTE'), INDEX_ROUTE)
})

test('客户端只 require 基座里的模块（多一个都会在组合阶段被拒）', () => {
  const required = new Set()
  const pattern = /require\('([^']+)'\)/g
  let match
  while ((match = pattern.exec(clientSource)) !== null) required.add(match[1])
  assert.deepEqual([...required], ['react'])
})
