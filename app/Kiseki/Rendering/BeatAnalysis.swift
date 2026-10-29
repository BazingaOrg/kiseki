import AVFoundation
import Accelerate
import Foundation

enum BeatAnalysis {
    struct Features: Equatable, Sendable {
        var times: [Double] = []
        var energy: [Double] = []
        var onset: [Double] = []
        var lowOnset: [Double] = []
    }

    static let empty = Features()
    static let sampleRate = 22050.0
    static let window = 1024
    static let hop = 512
    static let minimumDuration = 8.0
    static let minimumBeats = 4

    static func analyze(_ url: URL) -> Features {
        guard !url.path.isEmpty, FileManager.default.fileExists(atPath: url.path) else { return empty }
        guard let samples = read(url) else { return empty }
        return analyze(samples: samples, sampleRate: sampleRate)
    }

    static func analyze(samples: [Float], sampleRate: Double) -> Features {
        guard sampleRate > 0 else { return empty }
        let duration = Double(samples.count) / sampleRate
        guard duration >= minimumDuration, samples.count >= window else { return empty }
        let frames = frameFeatures(samples: samples, sampleRate: sampleRate)
        guard frames.energy.count >= 8 else { return empty }
        let peak = frames.energy.max() ?? 0
        if peak < 1e-5 { return empty }
        let times = beats(onset: frames.onset, sampleRate: sampleRate, duration: duration)
        guard times.count >= minimumBeats else { return empty }
        func sampled(_ values: [Float]) -> [Double] {
            times.map { time in
                let index = Int((time * sampleRate / Double(hop)).rounded())
                let clamped = min(max(0, index), values.count - 1)
                return Double(values[clamped])
            }
        }
        return Features(
            times: times,
            energy: unit(sampled(frames.energy)),
            onset: unit(sampled(frames.onset)),
            lowOnset: unit(sampled(frames.lowOnset))
        )
    }

    private struct Frames {
        var energy: [Float]
        var onset: [Float]
        var lowOnset: [Float]
    }

    private static func frameFeatures(samples: [Float], sampleRate: Double) -> Frames {
        let alpha = Float(1 - exp(-2 * Double.pi * 200 / sampleRate))
        var energy: [Float] = []
        var lowEnergy: [Float] = []
        energy.reserveCapacity(samples.count / hop)
        lowEnergy.reserveCapacity(samples.count / hop)
        var lowSquares = [Double](repeating: 0, count: window)
        var lowSquareSum = 0.0
        var state: Float = 0
        var ringIndex = 0
        var offset = 0
        for (index, sample) in samples.enumerated() {
            state += alpha * (sample - state)
            let square = Double(state) * Double(state)
            lowSquareSum += square - lowSquares[ringIndex]
            lowSquares[ringIndex] = square
            ringIndex = (ringIndex + 1) % window
            if index + 1 == offset + window {
                energy.append(rms(samples, offset: offset, count: window))
                lowEnergy.append(Float((max(0, lowSquareSum) / Double(window)).squareRoot()))
                offset += hop
            }
        }
        return Frames(energy: energy, onset: flux(energy), lowOnset: flux(lowEnergy))
    }

    private static func rms(_ samples: [Float], offset: Int, count: Int) -> Float {
        var value: Float = 0
        samples.withUnsafeBufferPointer { buffer in
            vDSP_rmsqv(buffer.baseAddress! + offset, 1, &value, vDSP_Length(count))
        }
        return value
    }

    private static func flux(_ values: [Float]) -> [Float] {
        guard !values.isEmpty else { return [] }
        var result = [Float](repeating: 0, count: values.count)
        for index in 1..<values.count {
            result[index] = max(0, values[index] - values[index - 1])
        }
        return result
    }

    private static func beats(onset: [Float], sampleRate: Double, duration: Double) -> [Double] {
        let minLag = max(1, Int((60.0 / 180.0) * sampleRate / Double(hop)))
        let maxLag = min(onset.count / 2, max(minLag + 1, Int((60.0 / 60.0) * sampleRate / Double(hop))))
        guard onset.count > maxLag + 2, maxLag > minLag else { return [] }
        var mean: Float = 0
        vDSP_meanv(onset, 1, &mean, vDSP_Length(onset.count))
        var centered = onset
        var negativeMean = -mean
        vDSP_vsadd(onset, 1, &negativeMean, &centered, 1, vDSP_Length(onset.count))
        var bestLag = minLag
        var best: Float = 0
        centered.withUnsafeBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            for lag in minLag...maxLag {
                var sum: Float = 0
                vDSP_dotpr(base, 1, base + lag, 1, &sum, vDSP_Length(onset.count - lag))
                sum /= Float(onset.count - lag)
                if sum > best {
                    best = sum
                    bestLag = lag
                }
            }
        }
        if best <= 1e-8 { return [] }
        var bestPhase = 0
        var bestScore: Float = -Float.greatestFiniteMagnitude
        for phase in 0..<bestLag {
            var score: Float = 0
            var index = phase
            while index < onset.count {
                score += onset[index]
                index += bestLag
            }
            if score > bestScore {
                bestScore = score
                bestPhase = phase
            }
        }
        let radius = max(1, bestLag / 4)
        var times: [Double] = []
        var index = bestPhase
        while index < onset.count {
            let lower = max(0, index - radius)
            let upper = min(onset.count - 1, index + radius)
            var peak = lower
            var value = onset[lower]
            for candidate in lower...upper where onset[candidate] >= value {
                value = onset[candidate]
                peak = candidate
            }
            let time = Double(peak) * Double(hop) / sampleRate
            if time >= 0, time < duration, times.last.map({ time > $0 + 1e-3 }) ?? true {
                times.append(time)
            }
            index += bestLag
        }
        return times
    }

    private static func unit(_ values: [Double]) -> [Double] {
        let finite = values.filter(\.isFinite)
        guard let lo = finite.min(), let hi = finite.max(), hi > lo else { return values.map { _ in 0.5 } }
        return values.map { value in
            if !value.isFinite { return 0.5 }
            return min(1, max(0, (value - lo) / (hi - lo)))
        }
    }

    private static func read(_ url: URL) -> [Float]? {
        do {
            let asset = AVURLAsset(url: url)
            guard let track = asset.tracks(withMediaType: .audio).first else { return nil }
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1
            ])
            output.alwaysCopiesSampleData = true
            guard reader.canAdd(output) else { return nil }
            reader.add(output)
            guard reader.startReading() else { return nil }
            var samples: [Float] = []
            let limit = Int(sampleRate * ProjectValidation.maximumDuration) + Int(sampleRate)
            while reader.status == .reading, let buffer = output.copyNextSampleBuffer() {
                guard let data = CMSampleBufferGetDataBuffer(buffer) else { continue }
                let length = CMBlockBufferGetDataLength(data)
                let count = length / MemoryLayout<Float>.size
                guard count > 0 else { continue }
                if samples.count + count > limit { return nil }
                var chunk = [Float](repeating: 0, count: count)
                let copied = chunk.withUnsafeMutableBytes { pointer in
                    CMBlockBufferCopyDataBytes(data, atOffset: 0, dataLength: count * MemoryLayout<Float>.size, destination: pointer.baseAddress!)
                }
                if copied != noErr { continue }
                samples.append(contentsOf: chunk)
            }
            if reader.status == .failed { return nil }
            return samples
        } catch {
            return nil
        }
    }
}
