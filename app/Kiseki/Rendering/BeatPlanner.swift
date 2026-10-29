import Foundation

struct PhotoCut: Equatable {
    let time: Double
    let score: Double
    let hard: Bool
}

private let hardCutScore = 0.55
private let neg = -1e100

func planPhotoCuts(
    duration: Double,
    nPhotos: Int,
    beatTimes: [Double],
    energy: [Double]? = nil,
    onset: [Double]? = nil,
    lowOnset: [Double]? = nil,
    lyricSpans: [(Double, Double)]? = nil,
    notBefore: Double = 0,
    headOffset: Double = 0,
    startOffset: Double = 0,
    notAfter: Double? = nil,
    fps: Int = 60
) -> [PhotoCut] {
    if nPhotos <= 1 || duration <= 0 { return [] }
    let prepared = prepareBeats(beatTimes, energy: energy, onset: onset, lowOnset: lowOnset, duration: duration)
    let times = prepared.times
    let scores = prepared.scores
    let need = nPhotos - 1
    let interval = beatInterval(times)
    let bar = interval * 4
    let lines = lyricSpans ?? []

    func place(count: Int, gap rawGap: Double) -> [(Double, Double)]? {
        let gap = max(rawGap, 1e-3)
        let firstLower = max(startOffset + gap, notBefore)
        let cap = lastCap(duration: duration, minGap: gap, notAfter: notAfter, headOffset: headOffset, nPhotos: nPhotos)
        if count < 1 || firstLower + Double(count - 1) * gap > cap + 1e-9 { return nil }
        let target = max((duration - headOffset) / Double(nPhotos), gap)
        let ideals = (1...count).map { index in
            headOffset + Double(index) * (duration - headOffset) / Double(nPhotos)
        }
        return search(
            times: times,
            scores: scores,
            need: count,
            start: startOffset,
            duration: duration,
            firstLower: firstLower,
            cap: cap,
            minGap: gap,
            target: target,
            ideals: ideals,
            lines: lines
        )
    }

    var chosen: [(Double, Double)]?
    for gap in [bar, interval] {
        chosen = place(count: need, gap: gap)
        if chosen != nil { break }
        if bar <= interval + 1e-9 { break }
    }
    if chosen == nil {
        if need > 1 {
            for count in stride(from: need - 1, through: 1, by: -1) {
                chosen = place(count: count, gap: interval)
                if chosen != nil { break }
            }
        }
    }
    if chosen == nil {
        let gap = max(interval, 1e-3)
        let firstLower = max(startOffset + gap, notBefore)
        let cap = lastCap(duration: duration, minGap: gap, notAfter: notAfter, headOffset: headOffset, nPhotos: nPhotos)
        chosen = fallback(
            need: need,
            duration: duration,
            headOffset: headOffset,
            nPhotos: nPhotos,
            firstLower: firstLower,
            minGap: gap,
            cap: cap,
            scores: scores,
            times: times
        )
    }
    let selected = chosen ?? []
    let quantized = quantize(selected.map(\.0), fps: fps, duration: duration)
    var byTime: [Double: Double] = [:]
    for pair in selected { byTime[pair.0] = pair.1 }
    return quantized.map { time in
        var score = byTime[time] ?? 0
        if score == 0, let nearest = byTime.keys.min(by: { abs($0 - time) < abs($1 - time) }), abs(nearest - time) <= 1 / Double(max(fps, 1)) {
            score = byTime[nearest] ?? 0
        }
        return PhotoCut(time: time, score: score, hard: score >= hardCutScore)
    }
}

func localDownbeatTimes(beatTimes: [Double], strength: [Double]) -> [Double] {
    let times = beatTimes.map { Double($0) }
    if times.count < 4 { return times }
    let gaps = zip(times, times.dropFirst()).compactMap { a, b -> Double? in b > a ? b - a : nil }
    let interval = gaps.isEmpty ? 0.5 : gaps.sorted()[gaps.count / 2]
    let bar = interval * 4
    if bar <= 0 { return times }
    var bins: [Int: [Int]] = [:]
    let origin = times[0]
    for (index, time) in times.enumerated() {
        guard time.isFinite, bar.isFinite else { continue }
        bins[Int((time - origin) / bar), default: []].append(index)
    }
    return bins.keys.sorted().map { key in
        let group = bins[key]!
        let best = maxIndex(group) { item in
            item < strength.count && strength[item].isFinite ? strength[item] : 0
        }
        return times[best]
    }
}

private func beatInterval(_ times: [Double]) -> Double {
    let gaps = zip(times, times.dropFirst()).compactMap { a, b -> Double? in b > a ? b - a : nil }
    if gaps.isEmpty { return 0.5 }
    return gaps.sorted()[gaps.count / 2]
}

private func prepareBeats(
    _ beatTimes: [Double],
    energy: [Double]?,
    onset: [Double]?,
    lowOnset: [Double]?,
    duration: Double
) -> (times: [Double], scores: [Double]) {
    var kept: [Double: Int] = [:]
    for (index, raw) in beatTimes.enumerated() {
        let time = Double(raw)
        if !time.isFinite || time < 0 || time > duration || kept[time] != nil { continue }
        kept[time] = index
    }
    let times = kept.keys.sorted()
    let loud = times.map { unitAt(energy, kept[$0]!, 0.5) }
    let attack: [Double]
    if let onset {
        attack = times.enumerated().map { index, time in
            kept[time]! >= onset.count ? loud[index] : unitAt(onset, kept[time]!, 0.5)
        }
    } else {
        attack = loud
    }
    let low = times.map { unitAt(lowOnset, kept[$0]!, 0.0) }
    return (times, beatScores(times: times, loud: loud, attack: attack, low: low, bar: beatInterval(times) * 4))
}

private func unitAt(_ values: [Double]?, _ index: Int, _ defaultValue: Double) -> Double {
    guard let values, index < values.count else { return defaultValue }
    let value = values[index]
    if !value.isFinite { return defaultValue }
    return min(1, max(0, value))
}

private func beatScores(times: [Double], loud: [Double], attack: [Double], low: [Double], bar: Double) -> [Double] {
    let count = times.count
    var rise = [0.0]
    if count > 1 {
        for index in 1..<count {
            rise.append(max(0, loud[index] - loud[index - 1]))
        }
    }
    var local = Array(repeating: 0.0, count: count)
    if count > 0, bar > 0 {
        var bins: [Int: [Int]] = [:]
        let origin = times[0]
        for (index, time) in times.enumerated() {
            bins[Int((time - origin) / bar), default: []].append(index)
        }
        for group in bins.values {
            let best = maxIndex(group) { item in
                0.6 * attack[item] + 0.4 * low[item] + 0.25 * rise[item]
            }
            local[best] = 1
        }
    }
    return (0..<count).map { index in
        0.35 * local[index] + 0.30 * attack[index] + 0.20 * low[index] + 0.15 * rise[index]
    }
}

private func lastCap(duration: Double, minGap: Double, notAfter: Double?, headOffset: Double, nPhotos: Int) -> Double {
    let hard = duration - minGap
    guard let notAfter, nPhotos > 1 else { return hard }
    let idealLast = headOffset + Double(nPhotos - 1) * (duration - headOffset) / Double(nPhotos)
    return min(hard, max(idealLast, notAfter))
}

private func gapCost(_ gap: Double, _ target: Double) -> Double {
    let low = 0.6 * target
    let high = 1.6 * target
    if gap < low { return (low - gap) / target }
    if gap > high { return (gap - high) / target }
    return 0
}

private func lyricAdjust(_ time: Double, _ lines: [(Double, Double)]) -> Double {
    var adjust = 0.0
    for (start, end) in lines {
        if !start.isFinite || !end.isFinite || end <= start { continue }
        if start + 0.05 < time && time < end - 0.25 {
            adjust -= 0.5
        } else if abs(time - end) <= 0.25 {
            adjust += 0.15
        }
    }
    return adjust
}

private func value(score: Double, time: Double, gap: Double, ideal: Double, target: Double, lyricAdjust: Double) -> Double {
    let pull = 0.35 * abs(time - ideal) / target
    return score + lyricAdjust - 1.2 * gapCost(gap, target) - pull
}

private func search(
    times: [Double],
    scores: [Double],
    need: Int,
    start: Double,
    duration: Double,
    firstLower: Double,
    cap: Double,
    minGap: Double,
    target: Double,
    ideals: [Double],
    lines: [(Double, Double)]
) -> [(Double, Double)]? {
    let cands = zip(times, scores).filter { firstLower - 1e-9 <= $0.0 && $0.0 <= cap + 1e-9 }.map { ($0.0, $0.1) }
    if cands.isEmpty { return nil }
    let count = cands.count
    let lyricAdjustments = cands.map { lyricAdjust($0.0, lines) }
    var dp = Array(repeating: Array(repeating: neg, count: count), count: need)
    var prev = Array(repeating: Array(repeating: -1, count: count), count: need)
    for index in 0..<count {
        let time = cands[index].0
        let score = cands[index].1
        let latest = latestAllowed(indexInPlan: 0, need: need, duration: duration, minGap: minGap, cap: cap)
        if time > latest + 1e-9 { continue }
        dp[0][index] = value(score: score, time: time, gap: time - start, ideal: ideals[0], target: target, lyricAdjust: lyricAdjustments[index])
    }
    if need > 1 {
        for placed in 1..<need {
            for index in 0..<count {
                let time = cands[index].0
                let score = cands[index].1
                let latest = latestAllowed(indexInPlan: placed, need: need, duration: duration, minGap: minGap, cap: cap)
                if time > latest + 1e-9 { continue }
                var best = neg
                var bestFrom = -1
                if index > 0 {
                    for earlier in 0..<index {
                        if dp[placed - 1][earlier] <= neg / 2 { continue }
                        let gap = time - cands[earlier].0
                        if gap + 1e-9 < minGap { continue }
                        let current = dp[placed - 1][earlier] + value(
                            score: score,
                            time: time,
                            gap: gap,
                            ideal: ideals[placed],
                            target: target,
                            lyricAdjust: lyricAdjustments[index]
                        )
                        if current > best {
                            best = current
                            bestFrom = earlier
                        }
                    }
                }
                dp[placed][index] = best
                prev[placed][index] = bestFrom
            }
        }
    }
    let endRow = need - 1
    var bestIndex = 0
    var bestScore = dp[endRow][0]
    for item in 1..<count {
        if dp[endRow][item] > bestScore {
            bestScore = dp[endRow][item]
            bestIndex = item
        }
    }
    if dp[endRow][bestIndex] <= neg / 2 { return nil }
    var chosen: [(Double, Double)] = []
    var cursor = bestIndex
    for placed in stride(from: endRow, through: 0, by: -1) {
        chosen.append(cands[cursor])
        cursor = prev[placed][cursor]
    }
    chosen.reverse()
    return chosen
}

private func latestAllowed(indexInPlan: Int, need: Int, duration: Double, minGap: Double, cap: Double) -> Double {
    let remainingCuts = need - 1 - indexInPlan
    let latest = cap - Double(remainingCuts) * minGap
    let tail = duration - Double(remainingCuts + 1) * minGap
    return min(latest, tail)
}

private func fallback(
    need: Int,
    duration: Double,
    headOffset: Double,
    nPhotos: Int,
    firstLower: Double,
    minGap: Double,
    cap: Double,
    scores: [Double],
    times: [Double]
) -> [(Double, Double)] {
    var points: [(Double, Double)] = []
    var indexed: [Double: Double] = [:]
    for (time, score) in zip(times, scores) { indexed[time] = score }
    for index in 1...need {
        let ideal = headOffset + Double(index) * (duration - headOffset) / Double(nPhotos)
        let lower = index == 1 ? firstLower : points[points.count - 1].0 + minGap
        let upper = min(cap, duration - Double(need - index + 1) * minGap)
        if lower > upper + 1e-9 { break }
        let time = min(max(ideal, lower), upper)
        points.append((time, indexed[time] ?? 0))
    }
    return points
}

private func quantize(_ times: [Double], fps: Int, duration: Double) -> [Double] {
    if fps <= 0 { return times }
    let frame = 1 / Double(fps)
    var quantized: [Double] = []
    var previous = 0.0
    for time in times {
        var snapped = time * Double(fps)
        snapped = snapped.rounded(.toNearestOrEven) / Double(fps)
        if snapped <= previous {
            snapped = ((previous + frame) * Double(fps)).rounded(.toNearestOrEven) / Double(fps)
        }
        if snapped >= duration { break }
        quantized.append(snapped)
        previous = snapped
    }
    return quantized
}

private func maxIndex<T: Comparable>(_ items: [Int], key: (Int) -> T) -> Int {
    var best = items[0]
    var bestKey = key(best)
    for item in items.dropFirst() {
        let current = key(item)
        if current > bestKey {
            best = item
            bestKey = current
        }
    }
    return best
}
