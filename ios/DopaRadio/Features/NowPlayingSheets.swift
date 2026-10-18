import SwiftUI

/// スタジオ（ネイティブDSP: EQ・低音ブースト・ボーカル除去・8D）
struct StudioSheet: View {
    @ObservedObject private var settings = AudioSettingsStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("イコライザー") {
                    Toggle("イコライザー", isOn: $settings.eqEnabled)
                        .tint(DopaColor.accent)

                    Group {
                        sliderRow("低音", value: $settings.eqBass, range: -15...15, suffix: "dB")
                        sliderRow("中音", value: $settings.eqMid, range: -15...15, suffix: "dB")
                        sliderRow("高音", value: $settings.eqTreble, range: -15...15, suffix: "dB")
                    }
                    .disabled(!settings.eqEnabled)
                    .opacity(settings.eqEnabled ? 1 : 0.45)
                }
                .listRowBackground(DopaColor.card)

                Section("低音ブースト") {
                    sliderRow("ブースト+", value: $settings.bassBoost, range: 0...15, suffix: "dB")
                }
                .listRowBackground(DopaColor.card)

                Section {
                    sliderRow("ボーカル除去", value: $settings.vocalRemoval, range: 0...100, suffix: "%")
                } footer: {
                    Text("中央のボーカルを打ち消します（カラオケ方式）。※モノラル音源は100%で無音になります。")
                }
                .listRowBackground(DopaColor.card)

                Section {
                    Toggle("8Dオーディオ（回転サウンド）", isOn: $settings.eightD)
                        .tint(DopaColor.accent)
                } footer: {
                    Text("ネイティブDSPで処理するため、バックグラウンド再生中も効きます（初回の反映に少し時間がかかることがあります）。")
                }
                .listRowBackground(DopaColor.card)
            }
            .scrollContentBackground(.hidden)
            .background(DopaColor.background)
            .navigationTitle("スタジオ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func sliderRow(
        _ label: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        suffix: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                Spacer()
                Text("\(value.wrappedValue > 0 && range.lowerBound < 0 ? "+" : "")\(Int(value.wrappedValue))\(suffix)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: 1)
                .tint(DopaColor.accent)
        }
    }
}

/// 速度・ピッチ（ピッチはサーバー生成の音源を使用）
struct SpeedPitchSheet: View {
    @ObservedObject private var settings = AudioSettingsStore.shared
    @Environment(\.dismiss) private var dismiss

    private let ratePresets: [Double] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text("速度")
                            Spacer()
                            Text(String(format: "%.2fx", settings.userRate))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Slider(value: $settings.userRate, in: 0.5...2.0, step: 0.05)
                            .tint(DopaColor.accent)
                    }
                    HStack(spacing: 6) {
                        ForEach(ratePresets, id: \.self) { rate in
                            Button {
                                settings.userRate = rate
                            } label: {
                                Text(rate == floor(rate) ? "\(Int(rate))x" : String(format: "%.2gx", rate))
                                    .font(.caption2.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 6)
                                    .background(
                                        abs(settings.userRate - rate) < 0.01
                                            ? DopaColor.accent.opacity(0.2) : DopaColor.card,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        abs(settings.userRate - rate) < 0.01
                                            ? DopaColor.accent : Color.secondary
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } footer: {
                    Text("iOSのネイティブ再生の上限に合わせて最大2.0xです。")
                }
                .listRowBackground(DopaColor.card)

                Section("ピッチ保持") {
                    Toggle("速度変更でも声を変えない（キーロック）", isOn: $settings.preservesPitch)
                        .tint(DopaColor.accent)
                }
                .listRowBackground(DopaColor.card)

                Section {
                    Picker("ピッチ", selection: $settings.pitchSemitones) {
                        ForEach(-12...12, id: \.self) { value in
                            Text(value > 0 ? "+\(value) 半音" : "\(value) 半音")
                                .tag(value)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(DopaColor.accent)
                } footer: {
                    Text("初回はサーバーで音源を生成します（数秒）。生成後はすぐ切り替わります。")
                }
                .listRowBackground(DopaColor.card)
            }
            .scrollContentBackground(.hidden)
            .background(DopaColor.background)
            .navigationTitle("速度・ピッチ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
    }
}
