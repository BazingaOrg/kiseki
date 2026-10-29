import UIKit
import CoreImage
import CoreImage.CIFilterBuiltins

enum FilmGrade {
    struct Roll: Identifiable, Equatable, Sendable {
        var id: String
        var name: String
        var desc: String
    }

    static let rolls: [Roll] = [
        Roll(id: "original", name: "原片", desc: "不处理，保留照片原本的色彩。"),
        Roll(id: "classic-chrome", name: "经典铬", desc: "饱和度低、阴影偏硬，红色收敛、天空偏青。纪实杂志的味道。"),
        Roll(id: "classic-neg", name: "怀旧负片", desc: "阴影带青、高光微微泛品红，反差偏硬。像九十年代冲印店洗出来的照片。"),
        Roll(id: "velvia", name: "浓彩正片", desc: "饱和与反差都拉满。拍人会过头，拍山、海、日落刚刚好。"),
        Roll(id: "astia", name: "柔和人像", desc: "肤色干净柔和，高光不刺眼，颜色准确但不寡淡。拍人最省心。"),
        Roll(id: "eterna", name: "电影青调", desc: "影调平缓、饱和度低，暗部带一点青。适合有情绪的画面。"),
    ]

    static func name(of id: String) -> String {
        rolls.first(where: { $0.id == id })?.name ?? "原片"
    }

    static func apply(_ image: UIImage, roll: String, strength: Double) -> UIImage {
        guard strength > 0, roll != "original", params[roll] != nil else { return image }
        guard let input = CIImage(image: image), let cube = cubeData(for: roll) else { return image }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        let cubeFilter = CIFilter.colorCubeWithColorSpace()
        cubeFilter.inputImage = input
        cubeFilter.cubeDimension = 16
        cubeFilter.cubeData = cube
        cubeFilter.colorSpace = space
        guard var output = cubeFilter.outputImage else { return image }
        if strength < 1 {
            let mix = CIFilter.mix()
            mix.inputImage = output
            mix.backgroundImage = input
            mix.amount = Float(min(1, strength))
            output = mix.outputImage ?? output
        }
        guard let cg = context.createCGImage(output, from: input.extent) else { return image }
        return UIImage(cgImage: cg, scale: image.scale, orientation: .up)
    }

    private static let lock = NSLock()
    private static var cubes: [String: Data] = [:]
    private static let context = CIContext(options: [
        .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB) as Any,
        .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB) as Any,
    ])

    private static func cubeData(for roll: String) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cubes[roll] { return cached }
        guard let color = params[roll] else { return nil }
        let data = bakeCube(color)
        cubes[roll] = data
        return data
    }

    private static func bakeCube(_ p: ColorParams) -> Data {
        let n = 16
        let count = n * n * n * 4
        var floats = [Float](repeating: 0, count: count)
        var offset = 0
        let denom = Double(n - 1)
        for b in 0..<n {
            for g in 0..<n {
                for r in 0..<n {
                    let rgb = transform(Double(r) / denom, Double(g) / denom, Double(b) / denom, p)
                    floats[offset] = Float(rgb[0])
                    floats[offset + 1] = Float(rgb[1])
                    floats[offset + 2] = Float(rgb[2])
                    floats[offset + 3] = 1
                    offset += 4
                }
            }
        }
        return floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    private struct ColorParams {
        var exp = 0.0
        var temp = 0.0
        var tint = 0.0
        var con = 1.0
        var piv = 0.45
        var black = 0.0
        var white = 1.0
        var sat = 1.0
        var satSh = 1.0
        var satHi = 1.0
        var shT = SIMD3<Double>(repeating: 0)
        var hiT = SIMD3<Double>(repeating: 0)
        var hueS = [1.0, 1, 1, 1, 1, 1]
        var hueH = [0.0, 0, 0, 0, 0, 0]
        var hueL = [0.0, 0, 0, 0, 0, 0]
        var mono = 0.0
        var monoMix = SIMD3<Double>(0.2126, 0.7152, 0.0722)
        var monoTone = SIMD3<Double>(repeating: 0)
    }

    private static let params: [String: ColorParams] = [
        "classic-chrome": ColorParams(
            con: 1.22, piv: 0.42, sat: 0.76, satHi: 0.85,
            shT: SIMD3(-0.01, 0, 0.015), hiT: SIMD3(0.01, 0.005, -0.01),
            hueS: [0.8, 0.75, 0.7, 1, 1.05, 0.85],
            hueH: [4, -2, 8, 0, -8, 0],
            hueL: [-0.03, 0, -0.03, 0, -0.04, 0]
        ),
        "classic-neg": ColorParams(
            con: 1.3, black: 0.02, sat: 0.9,
            shT: SIMD3(-0.02, 0.015, 0.03), hiT: SIMD3(0.03, -0.005, 0.01),
            hueS: [1.05, 0.85, 0.85, 1.1, 0.9, 1],
            hueH: [0, -6, 10, 0, 0, 0]
        ),
        "velvia": ColorParams(
            con: 1.4, sat: 1.55, satSh: 1.2,
            shT: SIMD3(0, 0, 0.01),
            hueS: [1.25, 1.2, 1.25, 1.2, 1.3, 1.3],
            hueH: [-4, 0, -4, 0, -6, 6],
            hueL: [-0.03, 0, -0.04, 0, -0.05, 0]
        ),
        "astia": ColorParams(
            temp: 0.03, con: 0.96, sat: 1.02, satHi: 0.88,
            hiT: SIMD3(0.008, 0.004, 0),
            hueS: [0.98, 0.96, 0.95, 1, 1.05, 1],
            hueH: [2, -2, 4, 0, 0, 0],
            hueL: [0.02, 0.025, 0, 0, 0, 0]
        ),
        "eterna": ColorParams(
            con: 0.78, black: 0.04, white: 0.95, sat: 0.68,
            shT: SIMD3(-0.02, 0.01, 0.02), hiT: SIMD3(0.01, 0.005, -0.005),
            hueS: [0.85, 0.85, 0.85, 1, 0.9, 0.85],
            hueH: [0, 0, 10, 0, -6, 0]
        ),
    ]

    private static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
    private static func fract(_ x: Double) -> Double { x - floor(x) }
    private static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = clamp01((x - a) / (b - a))
        return t * t * (3 - 2 * t)
    }
    private static func gain(_ x: Double, _ g: Double) -> Double {
        x < 0.5 ? 0.5 * pow(2 * x, g) : 1 - 0.5 * pow(2 - 2 * x, g)
    }
    private static func shoulder(_ x: Double) -> Double {
        let t = 0.78
        return x <= t ? x : t + (1 - t) * (1 - exp(-(x - t) / (1 - t)))
    }

    private static func rgbToHsv(_ c: SIMD3<Double>) -> SIMD3<Double> {
        let maxv = max(c[0], max(c[1], c[2]))
        let minv = min(c[0], min(c[1], c[2]))
        let d = maxv - minv
        var h = 0.0
        if d > 1e-10 {
            if maxv == c[0] { h = ((c[1] - c[2]) / d) / 6 }
            else if maxv == c[1] { h = ((c[2] - c[0]) / d + 2) / 6 }
            else { h = ((c[0] - c[1]) / d + 4) / 6 }
            h = fract(h)
        }
        return SIMD3(h, maxv > 1e-10 ? d / maxv : 0, maxv)
    }

    private static func hsvToRgb(_ h: Double, _ s: Double, _ v: Double) -> SIMD3<Double> {
        let k = [1.0, 2.0 / 3.0, 1.0 / 3.0]
        var out = SIMD3<Double>(repeating: 0)
        for i in 0..<3 {
            let p = abs(fract(h + k[i]) * 6 - 3)
            out[i] = v * (1 + (clamp01(p - 1) - 1) * s)
        }
        return out
    }

    private static func transform(_ r: Double, _ g: Double, _ b: Double, _ p: ColorParams) -> SIMD3<Double> {
        let e = log(0.5) / log(p.piv)
        let wb = SIMD3(1 + 0.2 * p.temp, 1 - 0.1 * p.tint, 1 - 0.2 * p.temp)
        let expGain = pow(2.0, p.exp)
        var c = SIMD3(r, g, b)
        for i in 0..<3 {
            let lin = shoulder(max(0, pow(c[i], 2.2) * expGain * wb[i]))
            let x = pow(clamp01(pow(lin, 1 / 2.2)), e)
            c[i] = pow(gain(x, p.con), 1 / e)
        }
        let hsv = rgbToHsv(c)
        var hs = 0.0, hh = 0.0, hl = 0.0
        for i in 0..<6 {
            var d = abs(hsv[0] * 6 - Double(i))
            d = min(d, 6 - d)
            let w = max(0.0, 1 - d)
            hs += w * (p.hueS[i] - 1)
            hh += w * p.hueH[i]
            hl += w * p.hueL[i]
        }
        let sw = smoothstep(0, 0.25, hsv[1])
        var rgb = hsvToRgb(fract(hsv[0] + (hh * sw) / 360), clamp01(hsv[1] * (1 + hs)), clamp01(hsv[2] + hl * hsv[1]))
        let l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        let sk = p.sat * (p.satSh + (p.satHi - p.satSh) * smoothstep(0.15, 0.85, l))
        let shW = (1 - l) * (1 - l) * 2
        let hiW = l * l * 2
        for i in 0..<3 { rgb[i] = l + (rgb[i] - l) * sk + p.shT[i] * shW + p.hiT[i] * hiW }
        if p.mono > 0 {
            let m = clamp01(clamp01(rgb[0]) * p.monoMix[0] + clamp01(rgb[1]) * p.monoMix[1] + clamp01(rgb[2]) * p.monoMix[2])
            for i in 0..<3 { rgb[i] += (m + p.monoTone[i] * 4 * m * (1 - m) - rgb[i]) * p.mono }
        }
        for i in 0..<3 { rgb[i] = clamp01(p.black + clamp01(rgb[i]) * (p.white - p.black)) }
        return rgb
    }
}
