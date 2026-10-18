import AVFoundation
import Foundation
import UIKit

/// AVPlayerItem にMTAudioProcessingTap（ネイティブDSP）を接続する
enum StudioTap {
    static func attach(to item: AVPlayerItem, dsp: TapDSP) {
        let retainedDSP = Unmanaged.passRetained(dsp)
        Task {
            do {
                let tracks = try await item.asset.loadTracks(withMediaType: .audio)
                guard let audioTrack = tracks.first else {
                    retainedDSP.release()
                    return
                }
                var callbacks = MTAudioProcessingTapCallbacks(
                    version: kMTAudioProcessingTapCallbacksVersion_0,
                    clientInfo: retainedDSP.toOpaque(),
                    init: tapInit,
                    finalize: tapFinalize,
                    prepare: tapPrepare,
                    unprepare: nil,
                    process: tapProcess
                )
                var tap: MTAudioProcessingTap?
                let status = MTAudioProcessingTapCreate(
                    kCFAllocatorDefault,
                    &callbacks,
                    kMTAudioProcessingTapCreationFlag_PostEffects,
                    &tap
                )
                guard status == noErr, let createdTap = tap else {
                    retainedDSP.release()
                    return
                }
                let parameters = AVMutableAudioMixInputParameters(track: audioTrack)
                parameters.audioTapProcessor = createdTap
                let mix = AVMutableAudioMix()
                mix.inputParameters = [parameters]
                item.audioMix = mix
            } catch {
                retainedDSP.release()
            }
        }
    }
}

private let tapInit: MTAudioProcessingTapInitCallback = { _, clientInfo, tapStorageOut in
    tapStorageOut.pointee = clientInfo
}

private let tapFinalize: MTAudioProcessingTapFinalizeCallback = { tap in
    let storage = MTAudioProcessingTapGetStorage(tap)
    Unmanaged<TapDSP>.fromOpaque(storage).release()
}

private let tapPrepare: MTAudioProcessingTapPrepareCallback = { tap, _, format in
    let storage = MTAudioProcessingTapGetStorage(tap)
    let dsp = Unmanaged<TapDSP>.fromOpaque(storage).takeUnretainedValue()
    dsp.prepare(format: format.pointee)
}

private let tapProcess: MTAudioProcessingTapProcessCallback = {
    tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
    let status = MTAudioProcessingTapGetSourceAudio(
        tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut
    )
    guard status == noErr else { return }
    let storage = MTAudioProcessingTapGetStorage(tap)
    let dsp = Unmanaged<TapDSP>.fromOpaque(storage).takeUnretainedValue()
    dsp.process(buffers: bufferListInOut)
}

enum Haptics {
    static func tap() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }

    static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.selectionChanged()
    }
}
