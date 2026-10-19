#if os(macOS)
import AppKit
import AVFoundation
import SwiftUI

/// Mac限定: AI作曲（Stable Audio 3.0 / MLX・完全ローカル・無料）
struct AIComposeView: View {
    @EnvironmentObject private var player: PlayerEngine
    @ObservedObject private var manager = StableAudioManager.shared
    @StateObject private var upload = UploadManager()

    @State private var prompt = ""
    @State private var negativePrompt = ""
    @State private var bundle: StableAudioManager.ModelBundle = .smallMusic
    @State private var seconds: Double = 60
    @State private var steps: Double = 8
    @State private var cfg: Double = 1.0
    @State private var randomSeed = true
    @State private var seedText = ""
    @State private var title = ""
    @State private var includeMedium = false
    @State private var showLog = false
    @State private var lastResult: URL?
    @State private var generated: [GeneratedFile] = []
    @State private var errorText: String?
    @State private var diskFree: Int64?
    @State private var durations: [String: Double] = [:]

    struct GeneratedFile: Identifiable {
        let url: URL
        var id: String { url.path }
        var title: String { url.deletingPathExtension().lastPathComponent }
    }

    private let presets: [(label: String, prompt: String)] = [
        (
            "ドパトランス",
            "high-energy Japanese EDM trance, 170 BPM, four-on-the-floor kick, pumping sidechain bass, supersaw chords, euphoric festival drop, instrumental"
        ),
        (
            "メガサビ",
            "massive J-pop EDM, 165 BPM, huge supersaw lead melody, punchy drums, dramatic build-up, explosive drop, instrumental"
        ),
        (
            "キラキラ",
            "kawaii future bass, 150 BPM, sparkling synths, cute plucky melody, hard-hitting drop, instrumental"
        ),
        (
            "チルドパ",
            "chill dopamine groove, 120 BPM, warm deep bass, relaxed head-nodding beat, lo-fi synths, instrumental"
        ),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if manager.phase == .ready && !manager.installedBundles.isEmpty {
                    composeUI
                } else {
                    setupUI
                }

                if let errorText {
                    Text(errorText)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(24)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(DopaColor.background)
        .navigationTitle("AI作曲")
        .onAppear {
            manager.refresh()
            diskFree = StableAudioManager.availableDiskSpace()
            refreshGenerated()
            if let first = manager.installedBundles.first {
                bundle = first
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(DopaColor.accent)
                Text("AI作曲（Stable Audio 3.0）")
                    .font(.title2.weight(.bold))
            }
            Text("Stability AIの音楽生成モデルをこのMacの中で実行します。初回のみモデルをダウンロードし、以後は完全オフライン・無料で何曲でも生成できます。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Powered by Stability AI（Stability AI Community License）")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - セットアップUI

    private var requiredBytes: Int64 {
        includeMedium ? 9_000_000_000 : 3_200_000_000
    }

    private var setupUI: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let diskFree {
                HStack(spacing: 6) {
                    Image(systemName: diskFree > requiredBytes ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(diskFree > requiredBytes ? .green : .yellow)
                    Text("空き容量: \(formatBytes(diskFree))（必要: 約\(formatBytes(requiredBytes))）")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("インストールするもの")
                    .font(.headline)

                HStack {
                    Image(systemName: "checkmark.square.fill")
                        .foregroundStyle(DopaColor.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("ランタイム（uv + Python 3.11 + MLX）")
                            .font(.callout.weight(.semibold))
                        Text("約1.2GB ・ 全モデル共通")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack {
                    Image(systemName: "checkmark.square.fill")
                        .foregroundStyle(DopaColor.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Small モデル（高速・最大120秒）")
                            .font(.callout.weight(.semibold))
                        Text("約1.8GB ＋ 共通0.5GB ・ M4なら120秒の曲を10秒前後で生成")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Button {
                    includeMedium.toggle()
                } label: {
                    HStack {
                        Image(systemName: includeMedium ? "checkmark.square.fill" : "square")
                            .foregroundStyle(includeMedium ? DopaColor.accent : Color.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Medium モデル（高品質・最大380秒）")
                                .font(.callout.weight(.semibold))
                            Text("約6.2GB ・ 後から追加もできます")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))

            if manager.phase == .settingUp {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text(manager.stepLabel)
                            .font(.callout)
                    }
                    if let progress = manager.stepProgress {
                        ProgressView(value: progress)
                            .tint(DopaColor.accent)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
            } else {
                Button {
                    manager.startSetup(downloadMedium: includeMedium)
                } label: {
                    Label("ダウンロードしてセットアップ", systemImage: "arrow.down.circle")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(DopaColor.accent)
                .foregroundStyle(.black)
                .disabled(diskFree != nil && diskFree! < requiredBytes)
            }

            logDisclosure

            Text("Stable Audio 3 の重みは Stability AI Community License に基づいて提供されます（年商100万ドル未満は無料・生成物はあなたの所有）。")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private var logDisclosure: some View {
        DisclosureGroup(isExpanded: $showLog) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(manager.logLines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(8)
            }
            .frame(maxHeight: 180)
            .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 8))
        } label: {
            Text("進行ログ")
                .font(.caption.weight(.semibold))
        }
    }

    // MARK: - 作曲UI

    private var composeUI: some View {
        VStack(alignment: .leading, spacing: 16) {
            modelRow
            promptCard
            settingsCard
            generateRow
            logDisclosure
            uploadStatusRow
            if let lastResult {
                resultCard(lastResult)
            }
            generatedList
        }
    }

    private var modelRow: some View {
        HStack(spacing: 10) {
            Picker("モデル", selection: $bundle) {
                ForEach(StableAudioManager.ModelBundle.allCases.filter { manager.installedBundles.contains($0) }) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: bundle) { _, newValue in
                if seconds > Double(newValue.maxSeconds) {
                    seconds = Double(newValue.maxSeconds)
                }
            }

            if !manager.installedBundles.contains(.medium), manager.phase == .ready {
                Button("Mediumを追加DL") {
                    manager.installMedium()
                }
                .font(.caption)
            }
        }
    }

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("プロンプト（英語がおすすめ）")
                .font(.headline)

            HStack(spacing: 6) {
                ForEach(presets, id: \.label) { preset in
                    Button(preset.label) {
                        prompt = preset.prompt
                    }
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(DopaColor.card, in: Capsule())
                    .overlay(Capsule().stroke(DopaColor.border))
                    .buttonStyle(.plain)
                }
            }

            TextEditor(text: $prompt)
                .font(.callout)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 74)
                .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(DopaColor.border))

            if cfg != 1.0 {
                TextField("ネガティブプロンプト（避けたい要素: vocals, distorted...）", text: $negativePrompt)
                    .textFieldStyle(.plain)
                    .padding(8)
                    .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(DopaColor.border))
            }
        }
    }

    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            sliderRow(
                "長さ", value: $seconds, range: 5...Double(bundle.maxSeconds), step: 5,
                valueLabel: "\(Int(seconds))秒"
            )
            sliderRow(
                "ステップ", value: $steps, range: 1...16, step: 1,
                valueLabel: "\(Int(steps))（8が標準）"
            )
            sliderRow(
                "ガイダンス(CFG)", value: $cfg, range: 0...10, step: 0.5,
                valueLabel: cfg == 1.0 ? "OFF" : String(format: "%.1f", cfg)
            )

            HStack(spacing: 12) {
                Toggle("シードをランダム", isOn: $randomSeed)
                    .toggleStyle(.checkbox)
                if !randomSeed {
                    TextField("例: 12345", text: $seedText)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 120)
                }
                Spacer()
                TextField("曲名（空なら自動）", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 200)
            }
        }
        .padding(16)
        .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))
    }

    private func sliderRow(
        _ label: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        step: Double,
        valueLabel: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                Spacer()
                Text(valueLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
                .tint(DopaColor.accent)
        }
    }

    private var generateRow: some View {
        HStack(spacing: 14) {
            Button {
                generate()
            } label: {
                HStack(spacing: 8) {
                    if manager.isGenerating {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "wand.and.stars")
                    }
                    Text(manager.isGenerating ? "生成中… \(Int(manager.generationElapsed))秒" : "生成する")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(DopaColor.accent)
            .foregroundStyle(.black)
            .disabled(manager.isGenerating || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if manager.isGenerating {
                Text(bundle == .smallMusic ? "だいたい10〜20秒で完成します" : "だいたい1〜2分かかります")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var uploadStatusRow: some View {
        switch upload.phase {
        case .preparing:
            Text("アップロードを準備中…")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .uploading(let ratio):
            VStack(alignment: .leading, spacing: 4) {
                Text("アップロード中 \(Int(ratio * 100))%")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ProgressView(value: ratio)
                    .tint(DopaColor.accent)
            }
        case .committing:
            Text("変換キューに追加中…")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .done:
            Text("アップロード完了！変換後にライブラリへ追加されます")
                .font(.caption)
                .foregroundStyle(.green)
        case .failed(let message):
            Text("アップロード失敗: \(message)")
                .font(.caption)
                .foregroundStyle(.red)
        case .idle:
            EmptyView()
        }
    }

    private func resultCard(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(url.deletingPathExtension().lastPathComponent)
                        .font(.headline)
                    Text("\(formatBytes(fileSize(url)))\(durationLabel(url)) ・ Stable Audio 3")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Spacer()
                Button {
                    play(url)
                } label: {
                    Label("再生", systemImage: "play.fill")
                }
                .buttonStyle(.bordered)

                Button {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                } label: {
                    Label("Finder", systemImage: "folder")
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await uploadTrack(url) }
                } label: {
                    Label("アップロード", systemImage: "arrow.up.circle")
                }
                .buttonStyle(.borderedProminent)
                .tint(DopaColor.accent)
                .foregroundStyle(.black)
                .disabled(upload.isBusy)
            }
        }
        .padding(16)
        .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.accent.opacity(0.5)))
    }

    private var generatedList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("生成済みの曲（書類/DOPA-AI）")
                .font(.headline)

            if generated.isEmpty {
                Text("まだありません。上の「生成する」で作ってみましょう。")
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
                            Text("\(formatBytes(fileSize(item.url)))\(durationLabel(item.url))")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Spacer()
                        Button {
                            play(item.url)
                        } label: {
                            Image(systemName: "play.circle")
                        }
                        .buttonStyle(.plain)
                        .help("再生")

                        Button {
                            Task { await uploadTrack(item.url) }
                        } label: {
                            Image(systemName: "arrow.up.circle")
                        }
                        .buttonStyle(.plain)
                        .help("アップロード")
                        .disabled(upload.isBusy)

                        Button {
                            try? FileManager.default.removeItem(at: item.url)
                            refreshGenerated()
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
        let request = StableAudioManager.GenerationRequest(
            prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines),
            negativePrompt: negativePrompt,
            bundle: bundle,
            seconds: Int(seconds),
            steps: Int(steps),
            cfg: cfg,
            seed: randomSeed ? nil : Int(seedText),
            title: title.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        errorText = nil
        upload.reset()
        Task {
            do {
                let url = try await manager.generate(request)
                lastResult = url
                refreshGenerated()
                play(url)
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    private func play(_ url: URL) {
        var tracks = generated.map { file in
            PlayerTrack(
                id: file.url.path,
                title: file.title,
                artist: "AI作曲（Stable Audio 3）",
                durationSec: durations[file.url.path].map { Int($0) },
                artworkURL: nil,
                chorusStartSec: nil,
                chorusEndSec: nil,
                localURL: file.url,
                directURL: nil
            )
        }
        let startIndex = tracks.firstIndex { $0.localURL == url } ?? 0
        if !tracks.contains(where: { $0.localURL == url }) {
            tracks.insert(
                PlayerTrack(
                    id: url.path,
                    title: url.deletingPathExtension().lastPathComponent,
                    artist: "AI作曲（Stable Audio 3）",
                    durationSec: durations[url.path].map { Int($0) },
                    artworkURL: nil,
                    chorusStartSec: nil,
                    chorusEndSec: nil,
                    localURL: url,
                    directURL: nil
                ),
                at: 0
            )
        }
        player.play(tracks: tracks, startAt: max(0, startIndex))
    }

    private func uploadTrack(_ url: URL) async {
        upload.reset()
        upload.importFile(url)
        upload.rightsConfirmed = true
        upload.visibility = "public"
        await upload.upload()
    }

    private func refreshGenerated() {
        let directory = StableAudioManager.outputDirectory
        let keys: [URLResourceKey] = [.creationDateKey]
        let items =
            (try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: keys
            )) ?? []
        generated = items
            .filter { $0.pathExtension.lowercased() == "wav" }
            .map { GeneratedFile(url: $0) }
            .sorted { $0.url.lastPathComponent > $1.url.lastPathComponent }
        loadDurations()
    }

    private func loadDurations() {
        for file in generated where durations[file.url.path] == nil {
            Task {
                let asset = AVURLAsset(url: file.url)
                if let loaded = try? await asset.load(.duration), loaded.seconds.isFinite {
                    durations[file.url.path] = loaded.seconds
                }
            }
        }
    }

    private func fileSize(_ url: URL) -> Int64 {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    }

    private func durationLabel(_ url: URL) -> String {
        guard let seconds = durations[url.path], seconds > 0 else { return "" }
        return " ・ \(Int(seconds))秒"
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}
#endif
