#if os(macOS)
import SwiftUI

/// Mac限定: AIドパ曲作曲（完全オフラインの自動作曲）
struct ComposeView: View {
    @EnvironmentObject private var player: PlayerEngine

    @State private var style: DopaComposer.Style = .dopaTrans
    @State private var bpm: Double = 152
    @State private var bars = 64
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var last: DopaComposer.Result?
    @State private var generated: [DopaComposer.GeneratedTrack] = []
    @StateObject private var upload = UploadManager()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                generatorCard
                if let last {
                    resultCard(last)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                generatedList
            }
            .padding(24)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background(DopaColor.background)
        .navigationTitle("AIドパ曲作曲")
        .onAppear { generated = DopaComposer.listGenerated() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(DopaColor.accent)
                Text("AIでドパ曲を作る")
                    .font(.title2.weight(.bold))
            }
            Text("進行・サビ構成・音色をアルゴリズムが即興で組み立てます。完全オフライン・無料。気に入ったらそのままアップロードして全デバイスで聴けます。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var generatorCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("スタイル", selection: $style) {
                ForEach(DopaComposer.Style.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: style) { _, newValue in
                bpm = Double(newValue.defaultBPM)
                bars = newValue.defaultBars
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("BPM")
                    Spacer()
                    Text("\(Int(bpm))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Slider(value: $bpm, in: 100...190, step: 1)
                    .tint(DopaColor.accent)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("長さ")
                    Spacer()
                    Text(lengthLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Slider(
                    value: Binding(
                        get: { Double(bars) },
                        set: { bars = Int($0) }
                    ),
                    in: 32...128,
                    step: 16
                )
                .tint(DopaColor.accent)
            }

            Button {
                generate()
            } label: {
                HStack(spacing: 8) {
                    if isGenerating {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "wand.and.stars")
                    }
                    Text(isGenerating ? "作曲中…" : "作曲する")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(DopaColor.accent)
            .foregroundStyle(.black)
            .disabled(isGenerating)
        }
        .padding(18)
        .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))
    }

    private var lengthLabel: String {
        let seconds = Double(bars) * 4 * 60 / bpm
        return "\(bars)小節（約\(Int(seconds))秒）"
    }

    private func resultCard(_ result: DopaComposer.Result) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.title)
                        .font(.headline)
                    Text(
                        "\(result.bpm)BPM ・ \(Int(result.durationSec))秒 ・ サビ \(formatTime(result.chorusStart))〜\(formatTime(result.chorusEnd))"
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                }
                Spacer()
                Button {
                    play(result)
                } label: {
                    Label("プレビュー", systemImage: "play.fill")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await uploadTrack(result) }
                } label: {
                    Label("アップロード", systemImage: "arrow.up.circle")
                }
                .buttonStyle(.borderedProminent)
                .tint(DopaColor.accent)
                .foregroundStyle(.black)
                .disabled(upload.isBusy)
            }

            if upload.isBusy || upload.phase == .done {
                uploadStatus
            }
        }
        .padding(16)
        .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(DopaColor.accent.opacity(0.5))
        )
    }

    @ViewBuilder
    private var uploadStatus: some View {
        switch upload.phase {
        case .preparing:
            statusRow("アップロードを準備中…")
        case .uploading(let ratio):
            VStack(alignment: .leading, spacing: 4) {
                statusRow("アップロード中 \(Int(ratio * 100))%")
                ProgressView(value: ratio)
                    .tint(DopaColor.accent)
            }
        case .committing:
            statusRow("変換キューに追加中…")
        case .done:
            statusRow("アップロード完了！変換後にライブラリへ追加されます")
        case .failed(let message):
            Text("失敗: \(message)")
                .font(.caption)
                .foregroundStyle(.red)
        case .idle:
            EmptyView()
        }
    }

    private func statusRow(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var generatedList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("生成済みの曲（このMacに保存）")
                .font(.headline)

            if generated.isEmpty {
                Text("まだありません。上の「作曲する」で作ってみましょう。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(generated) { item in
                    HStack(spacing: 10) {
                        Image(systemName: "waveform")
                            .foregroundStyle(DopaColor.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.title)
                                .font(.callout.weight(.semibold))
                                .lineLimit(1)
                            Text(item.createdAt.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            playFile(item)
                        } label: {
                            Image(systemName: "play.circle")
                        }
                        .buttonStyle(.plain)
                        .help("再生")

                        Button {
                            Task {
                                upload.reset()
                                upload.importFile(item.url)
                                upload.rightsConfirmed = true
                                await upload.upload()
                            }
                        } label: {
                            Image(systemName: "arrow.up.circle")
                        }
                        .buttonStyle(.plain)
                        .help("アップロード")
                        .disabled(upload.isBusy)

                        Button {
                            DopaComposer.deleteGenerated(item.url)
                            generated = DopaComposer.listGenerated()
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                        .help("削除")
                    }
                    .padding(.vertical, 4)
                    Divider()
                }
            }
        }
    }

    // MARK: - アクション

    private func generate() {
        guard !isGenerating else { return }
        isGenerating = true
        errorMessage = nil
        upload.reset()
        let style = style
        let bpm = Int(bpm)
        let bars = bars
        Task {
            do {
                let result = try await Task.detached(priority: .userInitiated) {
                    try DopaComposer.compose(style: style, bpm: bpm, bars: bars)
                }.value
                last = result
                generated = DopaComposer.listGenerated()
                play(result)
            } catch {
                errorMessage = "作曲に失敗しました: \(error.localizedDescription)"
            }
            isGenerating = false
        }
    }

    private func play(_ result: DopaComposer.Result) {
        player.play(tracks: [makeTrack(url: result.fileURL, title: result.title, duration: result.durationSec, chorusStart: result.chorusStart, chorusEnd: result.chorusEnd)], startAt: 0)
    }

    private func playFile(_ item: DopaComposer.GeneratedTrack) {
        player.play(tracks: [makeTrack(url: item.url, title: item.title, duration: nil, chorusStart: nil, chorusEnd: nil)], startAt: 0)
    }

    private func makeTrack(
        url: URL, title: String, duration: Double?, chorusStart: Double?, chorusEnd: Double?
    ) -> PlayerTrack {
        PlayerTrack(
            id: url.path,
            title: title,
            artist: "DOPA AI",
            durationSec: duration.map { Int($0) },
            artworkURL: nil,
            chorusStartSec: chorusStart.map { Int($0) },
            chorusEndSec: chorusEnd.map { Int($0) },
            localURL: url,
            directURL: nil
        )
    }

    private func uploadTrack(_ result: DopaComposer.Result) async {
        upload.reset()
        upload.importFile(result.fileURL)
        upload.rightsConfirmed = true
        upload.visibility = "public"
        await upload.upload()
    }
}
#endif
