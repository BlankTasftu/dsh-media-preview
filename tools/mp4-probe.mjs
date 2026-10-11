// Minimal MP4 (ISO-BMFF) box probe: top-level layout, moov position, per-track codecs.
// usage: node mp4-probe.mjs <file>
import fs from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: node mp4-probe.mjs <file>'); process.exit(2) }
const fd = fs.openSync(file, 'r')
const size = fs.statSync(file).size

function readAt(offset, length) {
  const buf = Buffer.alloc(Math.min(length, Math.max(0, size - offset)))
  if (buf.length === 0) return buf
  fs.readSync(fd, buf, 0, buf.length, offset)
  return buf
}

function boxHeader(offset) {
  if (offset + 8 > size) return null
  const head = readAt(offset, 16)
  let boxSize = head.readUInt32BE(0)
  const type = head.toString('latin1', 4, 8)
  let headerSize = 8
  if (boxSize === 1) { boxSize = Number(head.readBigUInt64BE(8)); headerSize = 16 }
  else if (boxSize === 0) boxSize = size - offset
  if (boxSize < headerSize) return null
  return { type, boxSize, headerSize, offset, body: offset + headerSize }
}

function children(parent) {
  const out = []
  let off = parent.body
  const end = parent.offset + parent.boxSize
  while (off + 8 <= end) {
    const child = boxHeader(off)
    if (!child) break
    out.push(child)
    off += child.boxSize
  }
  return out
}

function find(list, type) { return list.find((box) => box.type === type) }

console.log(`file: ${file}`)
console.log(`size: ${size} bytes\n`)

const top = children({ body: 0, offset: 0, boxSize: size })
console.log('== top-level boxes ==')
for (const box of top) {
  console.log(`  ${box.type.padEnd(6)} offset=${String(box.offset).padStart(10)} size=${box.boxSize}`)
}

const ftyp = find(top, 'ftyp')
if (ftyp) {
  const body = readAt(ftyp.body, 32)
  console.log(`\n== ftyp ==\n  major=${body.toString('latin1', 0, 4)} minor=${body.readUInt32BE(4)}`)
  const brands = []
  for (let i = 8; i + 4 <= Math.min(body.length, 32); i += 4) brands.push(body.toString('latin1', i, i + 4))
  console.log(`  compatible=${brands.join(' ')}`)
}

const moov = find(top, 'moov')
const mdat = find(top, 'mdat')
console.log(`\n== layout ==`)
console.log(`  moov: ${moov ? `offset=${moov.offset}` : 'MISSING'}`)
console.log(`  mdat: ${mdat ? `offset=${mdat.offset} size=${mdat.boxSize}` : 'MISSING'}`)
if (moov && mdat) {
  console.log(`  => moov 在 mdat ${moov.offset < mdat.offset ? '之前（faststart，可顺序播放）' : '之后（播放器必须先 seek 到文件尾部才能起播）'}`)
}

if (moov) {
  const moovChildren = children(moov)
  console.log(`\n== moov children ==\n  ${moovChildren.map((b) => b.type).join(' ')}`)
  const traks = moovChildren.filter((box) => box.type === 'trak')
  traks.forEach((trak, index) => {
    const t = children(trak)
    const mdia = find(t, 'mdia')
    if (!mdia) return
    const m = children(mdia)
    const hdlr = find(m, 'hdlr')
    const handler = hdlr ? readAt(hdlr.body + 8, 4).toString('latin1') : '?'
    const stbl = find(children(find(m, 'minf') ?? { body: 0, boxSize: 0, offset: 0 }), 'stbl')
    let fourcc = '?'
    let extra = ''
    if (stbl) {
      const stsd = find(children(stbl), 'stsd')
      if (stsd) {
        const entry = boxHeader(stsd.body + 8)
        if (entry) {
          fourcc = entry.type
          const blob = readAt(entry.offset, Math.min(entry.boxSize, 4096))
          for (const codecBox of ['avcC', 'hvcC', 'av1C', 'vpcC', 'esds', 'dOps']) {
            const at = blob.indexOf(codecBox, 8)
            if (at === -1) continue
            if (codecBox === 'avcC') {
              extra += ` avcC[profile=${blob[at + 5]} level=${blob[at + 7]}]`
            } else if (codecBox === 'hvcC') {
              const profileSpace = blob[at + 5] >> 6
              const tierFlag = (blob[at + 5] >> 5) & 1
              const profileIdc = blob[at + 5] & 0x1f
              extra += ` hvcC[profile_space=${profileSpace} tier=${tierFlag} profile_idc=${profileIdc} level_idc=${blob[at + 16]}]`
            } else {
              extra += ` ${codecBox}`
            }
          }
        }
      }
    }
    console.log(`  trak#${index}: handler=${handler} codec=${fourcc}${extra}`)
  })
}

fs.closeSync(fd)
