#if os(macOS)
import SwiftUI

/// ドパドパ加工の実行状態
@MainActor
final class DopaDopeRunner: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var stepLabel = ""

    func run(source: URL, options: DopaDoper.Options) async throws -> DopaDoper.Result {
        isRunning = true
        stepLabel = "準備中…"
        defer { isRunning = false }
        return try await Task.detached(priority: .userInitiated) { [weak self] in
            try DopaDoper.process(sourceURL: source, options: options) { label in
                Task { @MainActor in
                    self?.stepLabel = label
                }
            }
        }.value
    }
}

/// ドパドパ加工シート（テンポ変換＋4つ打ち＋ポンプのパラメータ）
struct DopaDopeSheet: View {
    let sourceURL: URL
    let onComplete: (URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var runner = DopaDopeRunner()

    @State private var targetBPM: Double = 170
    @State private var drumLevel: Double = 0.9
    @State private var bassLevel: Double = 0.85
    @State private var pumpDepth: Double = 0.55
    @State private var addBass = true
    @State private var addPump = true
    @State private var error: String?

    @State private var detectedBPM: Double?
    @State private var isAnalyzing = false
    @State private var manualBPMText = ""
    @State private var useManualBPM = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "wand.and.stars")
                        .foregroundStyle(DopaColor.accent)
                    Text("ノリノリ加工")
                        .font(.title3.weight(.bold))
                }
                Text("\(sourceURL.deletingPathExtension().lastPathComponent)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("BPMとキーを解析して目標テンポへ変換（キー維持）し、4つ打ちキック・オフビートベース・サイドチェインポンプを重ねます。")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("元のBPM")
                    Spacer()
                    if isAnalyzing {
                        ProgressView()
                            .controlSize(.small)
                        Text("解析中…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if useManualBPM {
                        TextField("例: 128", text: $manualBPMText)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                    } else if let detectedBPM {
                        Text("\(Int(detectedBPM.rounded()))")
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                    } else {
                        Text("検出できません")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    Toggle("手動", isOn: $useManualBPM)
                        .toggleStyle(.checkbox)
                        .font(.caption)
                }

                sliderRow(
                    "目標BPM", value: $targetBPM, range: 150...190, step: 1,
                    valueLabel: "\(Int(targetBPM))"
                )
                sliderRow(
                    "ドラム", value: $drumLevel, range: 0...1.3, step: 0.05,
                    valueLabel: "\(Int(drumLevel * 100))%"
                )
                sliderRow(
                    "ベース", value: $bassLevel, range: 0...1.2, step: 0.05,
                    valueLabel: "\(Int(bassLevel * 100))%"
                )
                sliderRow(
                    "ポンプの強さ", value: $pumpDepth, range: 0...0.8, step: 0.05,
                    valueLabel: "\(Int(pumpDepth * 100))%"
                )

                HStack(spacing: 18) {
                    Toggle("キーに合わせてベースを追加", isOn: $addBass)
                        .toggleStyle(.checkbox)
                    Toggle("サイドチェインポンプ", isOn: $addPump)
                        .toggleStyle(.checkbox)
                }
                .font(.caption)
            }
            .padding(16)
            .background(DopaColor.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(DopaColor.border))

            if runner.isRunning {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(runner.stepLabel)
                        .font(.callout)
                }
            }

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("キャンセル") { dismiss() }
                    .disabled(runner.isRunning)
                Button {
                    start()
                } label: {
                    Label("加工する", systemImage: "sparkles")
                }
                .buttonStyle(.borderedProminent)
                .tint(DopaColor.accent)
                .foregroundStyle(.black)
                .disabled(runner.isRunning)
            }
        }
        .padding(24)
        .frame(width: 500)
        .background(DopaColor.background)
        .task {
            isAnalyzing = true
            let url = sourceURL
            let bpm = await Task.detached(priority: .userInitiated) {
                try? DopaDoper.loadAndDetectBPM(url: url)
            }.value
            detectedBPM = bpm
            isAnalyzing = false
            if let bpm, bpm < 140 {
                // 遅い曲はそのままだと加工感が弱いので目標を上げておく
                targetBPM = min(180, max(170, bpm * 1.3))
            }
        }
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

    private func start() {
        error = nil
        let manual = useManualBPM ? Double(manualBPMText.trimmingCharacters(in: .whitespaces)) : nil
        if useManualBPM, manual == nil {
            error = "元のBPMを数字で入力してください"
            return
        }
        let options = DopaDoper.Options(
            targetBPM: targetBPM,
            drumLevel: Float(drumLevel),
            bassLevel: Float(bassLevel),
            pumpDepth: Float(pumpDepth),
            addBass: addBass,
            addPump: addPump,
            manualBPM: manual
        )
        Task {
            do {
                let result = try await runner.run(source: sourceURL, options: options)
                onComplete(result.fileURL)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
#endif
