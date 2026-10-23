import AVFoundation
import Foundation

/// アップロード前の音声圧縮（AAC / m4a）
enum AudioCompressor {
    enum Quality: String, CaseIterable, Identifiable {
        case original
        case high
        case standard
        case light

        var id: String { rawValue }

        var label: String {
            switch self {
            case .original: return "元のまま"
            case .high: return "高音質 256kbps"
            case .standard: return "標準 192kbps"
            case .light: return "軽量 128kbps"
            }
        }

        var shortLabel: String {
            switch self {
            case .original: return "元のまま"
            case .high: return "256k"
            case .standard: return "192k"
            case .light: return "128k"
            }
        }

        var bitrate: Int? {
            switch self {
            case .original: return nil
            case .high: return 256_000
            case .standard: return 192_000
            case .light: return 128_000
            }
        }
    }

    enum CompressError: LocalizedError {
        case noAudio
        case readerFailed
        case writerFailed
        case writeFailed(String?)

        var errorDescription: String? {
            switch self {
            case .noAudio: return "音声トラックが見つかりません"
            case .readerFailed: return "音源を読み込めませんでした"
            case .writerFailed: return "圧縮の準備に失敗しました"
            case .writeFailed(let message):
                return "圧縮に失敗しました\(message.map { ": \($0)" } ?? "")"
            }
        }
    }

    static func estimatedBytes(duration: Double, bitrate: Int) -> Int64 {
        guard duration > 0, bitrate > 0 else { return 0 }
        return Int64(duration * Double(bitrate) / 8) + 64 * 1024
    }

    /// 指定ビットレートのAAC（.m4a）へ変換して一時ファイルURLを返す
    static func compress(
        source: URL,
        bitrate: Int,
        progress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> URL {
        let input: AVAudioFile
        do {
            input = try AVAudioFile(forReading: source)
        } catch {
            throw CompressError.readerFailed
        }
        guard input.length > 0 else { throw CompressError.noAudio }

        let format = input.processingFormat
        // AVAudioFileの読み出しはFloat32（非インターリーブ）で返る
        guard format.commonFormat == .pcmFormatFloat32, format.channelCount <= 2 else {
            return try await fallbackExport(source: source, progress: progress)
        }

        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("dopa-compressed-\(UUID().uuidString).m4a")
        try? FileManager.default.removeItem(at: destination)

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            AVEncoderBitRateKey: bitrate,
        ]
        let output: AVAudioFile
        do {
            output = try AVAudioFile(forWriting: destination, settings: settings)
        } catch {
            throw CompressError.writerFailed
        }

        let chunkFrames: AVAudioFrameCount = 32_768
        let totalFrames = Double(input.length)
        var processedFrames: Double = 0

        let outputFormat = output.processingFormat
        let channelCount = Int(format.channelCount)
        let sourceInterleaved = format.isInterleaved
        let outputInterleaved = outputFormat.isInterleaved

        do {
            while true {
                let remaining = Int(input.length) - Int(processedFrames)
                if remaining <= 0 { break }
                guard let buffer = AVAudioPCMBuffer(
                    pcmFormat: format, frameCapacity: chunkFrames
                ) else { break }
                try input.read(
                    into: buffer,
                    frameCount: AVAudioFrameCount(min(Int(chunkFrames), remaining))
                )
                let frames = Int(buffer.frameLength)
                if frames == 0 { break }
                guard let source = buffer.floatChannelData else { break }

                guard let converted = AVAudioPCMBuffer(
                    pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(frames)
                ), let destinationChannels = converted.floatChannelData else {
                    throw CompressError.writerFailed
                }
                converted.frameLength = AVAudioFrameCount(frames)

                for frame in 0..<frames {
                    for channel in 0..<channelCount {
                        let value = sourceInterleaved
                            ? source[0][frame * channelCount + channel]
                            : source[channel][frame]
                        if outputInterleaved {
                            destinationChannels[0][frame * channelCount + channel] = value
                        } else {
                            destinationChannels[channel][frame] = value
                        }
                    }
                }

                try output.write(from: converted)
                processedFrames += Double(frames)
                if totalFrames > 0 {
                    progress?(min(0.99, processedFrames / totalFrames))
                }
            }
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw CompressError.writeFailed(error.localizedDescription)
        }

        progress?(1)
        return destination
    }

    /// 特殊フォーマット（高サンプルレート等）はOSのエクスポートに任せる
    private static func fallbackExport(
        source: URL,
        progress: (@Sendable (Double) -> Void)?
    ) async throws -> URL {
        let asset = AVURLAsset(url: source)
        guard
            let session = AVAssetExportSession(
                asset: asset, presetName: AVAssetExportPresetAppleM4A
            )
        else {
            throw CompressError.writerFailed
        }
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("dopa-compressed-\(UUID().uuidString).m4a")
        try? FileManager.default.removeItem(at: destination)
        session.outputURL = destination
        session.outputFileType = .m4a
        progress?(0.1)
        await session.export()
        progress?(1)
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: destination)
            throw CompressError.writeFailed(session.error?.localizedDescription)
        }
        return destination
    }
}
