/**
 * `Range` 解析的单元测试。
 *
 * 这一层错了，症状会是"视频能播但进度条拖不动"或"拖到某处就卡死" —— 极难从
 * 表面现象倒推回解析逻辑，所以边界值必须逐个钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RANGE_MALFORMED,
  RANGE_NONE,
  RANGE_OK,
  RANGE_UNSATISFIABLE,
  clampWindow,
  formatContentRange,
  formatUnsatisfiedRange,
  parseByteRange,
  windowLength,
} from '../lib/range.mjs'

test('没有 Range 头 → none（按 200 返回完整实体）', () => {
  assert.deepEqual(parseByteRange(null, 100), { kind: RANGE_NONE })
  assert.deepEqual(parseByteRange(undefined, 100), { kind: RANGE_NONE })
  assert.deepEqual(parseByteRange('', 100), { kind: RANGE_NONE })
  assert.deepEqual(parseByteRange('   ', 100), { kind: RANGE_NONE })
})

test('`bytes=0-` 是"到文件末尾"，必须被裁成 size-1', () => {
  assert.deepEqual(parseByteRange('bytes=0-', 100), { kind: RANGE_OK, start: 0, end: 99 })
})

test('闭区间与开区间', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 100), { kind: RANGE_OK, start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { kind: RANGE_OK, start: 10, end: 19 })
  assert.deepEqual(parseByteRange('bytes=90-', 100), { kind: RANGE_OK, start: 90, end: 99 })
  // 结束位置超出实体：按 RFC 裁到 size-1，而不是报错。
  assert.deepEqual(parseByteRange('bytes=90-1000', 100), { kind: RANGE_OK, start: 90, end: 99 })
})

test('后缀区间 `bytes=-N` 取最后 N 字节', () => {
  assert.deepEqual(parseByteRange('bytes=-10', 100), { kind: RANGE_OK, start: 90, end: 99 })
  // N 大于实体长度：给整个实体。
  assert.deepEqual(parseByteRange('bytes=-500', 100), { kind: RANGE_OK, start: 0, end: 99 })
  // `-0` 不是"最后 0 字节"，而是无意义区间。
  assert.deepEqual(parseByteRange('bytes=-0', 100), { kind: RANGE_UNSATISFIABLE })
})

test('起点越界 → 416 的 unsatisfiable', () => {
  assert.deepEqual(parseByteRange('bytes=100-', 100), { kind: RANGE_UNSATISFIABLE })
  assert.deepEqual(parseByteRange('bytes=1000-2000', 100), { kind: RANGE_UNSATISFIABLE })
})

test('空实体上的任何区间都不可满足', () => {
  assert.deepEqual(parseByteRange('bytes=0-', 0), { kind: RANGE_UNSATISFIABLE })
  assert.deepEqual(parseByteRange('bytes=-1', 0), { kind: RANGE_UNSATISFIABLE })
})

test('语法错误按 RFC 被忽略（malformed），而不是 416', () => {
  assert.deepEqual(parseByteRange('items=0-10', 100), { kind: RANGE_MALFORMED })
  assert.deepEqual(parseByteRange('bytes=abc', 100), { kind: RANGE_MALFORMED })
  assert.deepEqual(parseByteRange('bytes=10-5', 100), { kind: RANGE_MALFORMED })
  assert.deepEqual(parseByteRange('bytes=', 100), { kind: RANGE_MALFORMED })
  assert.deepEqual(parseByteRange('bytes=1-2,', 100), { kind: RANGE_MALFORMED })
})

test('多区间只取第一个（不做 multipart/byteranges）', () => {
  assert.deepEqual(parseByteRange('bytes=0-9, 20-29', 100), { kind: RANGE_OK, start: 0, end: 9 })
})

test('大小写与空格容错', () => {
  assert.deepEqual(parseByteRange('BYTES = 5-9', 100), { kind: RANGE_OK, start: 5, end: 9 })
})

test('clampWindow 只"少给"，从不越过请求的末尾', () => {
  assert.deepEqual(clampWindow(0, 99, 10), { start: 0, end: 9 })
  assert.deepEqual(clampWindow(0, 3, 10), { start: 0, end: 3 })
  assert.deepEqual(clampWindow(50, 60, 10), { start: 50, end: 59 })
  // 非正/非法上限视为不限制（由配置层负责钳制，这里不该偷偷改变语义）。
  assert.deepEqual(clampWindow(0, 99, 0), { start: 0, end: 99 })
  assert.deepEqual(clampWindow(0, 99, Number.NaN), { start: 0, end: 99 })
})

test('Content-Range 的两种写法', () => {
  assert.equal(formatContentRange(0, 1048575, 1073741824), 'bytes 0-1048575/1073741824')
  assert.equal(formatUnsatisfiedRange(0), 'bytes */0')
  assert.equal(formatUnsatisfiedRange(123), 'bytes */123')
})

test('windowLength', () => {
  assert.equal(windowLength(0, 0), 1)
  assert.equal(windowLength(0, 9), 10)
  assert.equal(windowLength(5, 4), 0)
})
