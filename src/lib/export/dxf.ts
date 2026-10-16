// 최소 DXF(R12, AC1009) 작성기. AutoCAD·ZWCAD·BricsCAD·LibreCAD·QGIS에서 열린다.
// 한글 문자는 R12 규칙대로 \U+XXXX로 적어 코드페이지와 상관없이 보이게 한다. 단위는 m.

export type Pt = [number, number]

interface Layer {
  name: string
  /** AutoCAD 색 번호(ACI) */
  color: number
}

const num = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(4)).toString() : '0')

function encodeText(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code < 128) out += ch
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    else out += '?'
  }
  return out
}

export class DxfWriter {
  private layers: Layer[] = []
  private body: string[] = []
  private minX = Infinity
  private minY = Infinity
  private maxX = -Infinity
  private maxY = -Infinity

  layer(name: string, color: number): this {
    if (!this.layers.some((l) => l.name === name)) this.layers.push({ name, color })
    return this
  }

  private g(code: number, value: string | number) {
    this.body.push(String(code), typeof value === 'number' ? num(value) : value)
  }

  private extend([x, y]: Pt) {
    this.minX = Math.min(this.minX, x)
    this.minY = Math.min(this.minY, y)
    this.maxX = Math.max(this.maxX, x)
    this.maxY = Math.max(this.maxY, y)
  }

  polyline(layer: string, pts: Pt[], closed = false): this {
    const list = closed && pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1] ? pts.slice(0, -1) : pts
    if (list.length < 2) return this
    this.g(0, 'POLYLINE')
    this.g(8, layer)
    this.g(66, '1')
    this.g(10, 0)
    this.g(20, 0)
    this.g(30, 0)
    this.g(70, closed ? '1' : '0')
    for (const p of list) {
      this.extend(p)
      this.g(0, 'VERTEX')
      this.g(8, layer)
      this.g(10, p[0])
      this.g(20, p[1])
      this.g(30, 0)
    }
    this.g(0, 'SEQEND')
    this.g(8, layer)
    return this
  }

  line(layer: string, a: Pt, b: Pt): this {
    this.extend(a)
    this.extend(b)
    this.g(0, 'LINE')
    this.g(8, layer)
    this.g(10, a[0])
    this.g(20, a[1])
    this.g(30, 0)
    this.g(11, b[0])
    this.g(21, b[1])
    this.g(31, 0)
    return this
  }

  circle(layer: string, c: Pt, r: number): this {
    this.extend([c[0] - r, c[1] - r])
    this.extend([c[0] + r, c[1] + r])
    this.g(0, 'CIRCLE')
    this.g(8, layer)
    this.g(10, c[0])
    this.g(20, c[1])
    this.g(30, 0)
    this.g(40, r)
    return this
  }

  /** align: left(기준점이 글자 왼쪽 아래) 또는 center(기준점이 글자 아래쪽 가운데) */
  text(layer: string, p: Pt, height: number, text: string, align: 'left' | 'center' = 'left', rotation = 0): this {
    this.extend(p)
    this.g(0, 'TEXT')
    this.g(8, layer)
    this.g(10, p[0])
    this.g(20, p[1])
    this.g(30, 0)
    this.g(40, height)
    this.g(1, encodeText(text))
    if (rotation) this.g(50, rotation)
    if (align === 'center') {
      this.g(72, '1')
      this.g(11, p[0])
      this.g(21, p[1])
      this.g(31, 0)
    }
    return this
  }

  toString(): string {
    const out: string[] = []
    const g = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? num(value) : value)
    const has = Number.isFinite(this.minX)
    g(0, 'SECTION')
    g(2, 'HEADER')
    g(9, '$ACADVER')
    g(1, 'AC1009')
    g(9, '$INSUNITS')
    g(70, '6')
    g(9, '$EXTMIN')
    g(10, has ? this.minX : 0)
    g(20, has ? this.minY : 0)
    g(30, 0)
    g(9, '$EXTMAX')
    g(10, has ? this.maxX : 0)
    g(20, has ? this.maxY : 0)
    g(30, 0)
    g(0, 'ENDSEC')

    g(0, 'SECTION')
    g(2, 'TABLES')
    g(0, 'TABLE')
    g(2, 'LTYPE')
    g(70, '1')
    g(0, 'LTYPE')
    g(2, 'CONTINUOUS')
    g(70, '0')
    g(3, 'Solid line')
    g(72, '65')
    g(73, '0')
    g(40, 0)
    g(0, 'ENDTAB')
    g(0, 'TABLE')
    g(2, 'LAYER')
    g(70, String(this.layers.length + 1))
    for (const l of [{ name: '0', color: 7 }, ...this.layers]) {
      g(0, 'LAYER')
      g(2, l.name)
      g(70, '0')
      g(62, String(l.color))
      g(6, 'CONTINUOUS')
    }
    g(0, 'ENDTAB')
    g(0, 'TABLE')
    g(2, 'STYLE')
    g(70, '1')
    g(0, 'STYLE')
    g(2, 'STANDARD')
    g(70, '0')
    g(40, 0)
    g(41, 1)
    g(50, 0)
    g(71, '0')
    g(42, 2.5)
    g(3, 'txt')
    g(4, '')
    g(0, 'ENDTAB')
    g(0, 'ENDSEC')

    g(0, 'SECTION')
    g(2, 'ENTITIES')
    const tail: string[] = []
    tail.push('0', 'ENDSEC', '0', 'EOF')
    // 본문은 수십만 줄이 될 수 있어 펼쳐 넣지 않고 이어 붙인다.
    return [out.join('\r\n'), this.body.join('\r\n'), tail.join('\r\n')].join('\r\n') + '\r\n'
  }
}
