import SwiftUI
import UniformTypeIdentifiers

/// 曲のアップロード（ネイティブ）
struct UploadView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var manager = UploadManager()
    @State private var showFilePicker = false

    private static let visibilityLabels: [(key: String, label: String)] = [
        ("public", "公開"),
        ("unlisted", "限定公開"),
        ("private", "非公開"),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section("音源ファイル") {
                    if let name = manager.fileName {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(name)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(2)
                            Text(formatBytes(manager.fileSizeBytes))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("mp3 / m4a / aac / wav / flac / ogg（100MBまで）")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        showFilePicker = true
                    } label: {
                        Label(manager.fileName == nil ? "ファイルを選択" : "選び直す",
                              systemImage: "doc.badge.plus")
                    }
                    .disabled(manager.isBusy)
                }
                .listRowBackground(DopaColor.card)

                Section("公開範囲") {
                    Picker("公開範囲", selection: $manager.visibility) {
                        ForEach(Self.visibilityLabels, id: \.key) { item in
                            Text(item.label).tag(item.key)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(manager.isBusy)
                }
                .listRowBackground(DopaColor.card)

                Section {
                    Toggle(isOn: $manager.rightsConfirmed) {
                        Text("自分が権利を持つ音源、または許諾を得た音源です")
                            .font(.footnote)
                    }
                    .tint(DopaColor.accent)
                    .disabled(manager.isBusy)
                } footer: {
                    Text("市販の楽曲はアップロードできません。Apple Music / Spotify 連携でプレイリストに追加してください。")
                }
                .listRowBackground(DopaColor.card)

                Section {
                    phaseView
                }
                .listRowBackground(DopaColor.card)
            }
            .scrollContentBackground(.hidden)
            .background(DopaColor.background)
            .navigationTitle("アップロード")
            .dopaInlineTitle()
            .toolbar {
                ToolbarItem(placement: .dopaLeading) {
                    Button("閉じる") { dismiss() }
                        .disabled(manager.isBusy)
                }
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: Self.allowedTypes,
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        manager.importFile(url)
                    }
                case .failure:
                    break
                }
            }
        }
    }

    @ViewBuilder
    private var phaseView: some View {
        switch manager.phase {
        case .idle:
            Button {
                Task { await manager.upload() }
            } label: {
                HStack {
                    if manager.isBusy { ProgressView().tint(.black) }
                    Text("アップロード")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .background(DopaColor.accent, in: Capsule())
            .foregroundStyle(.black)
            .disabled(!manager.canUpload)
            .opacity(manager.canUpload ? 1 : 0.5)
            .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 20))
        case .preparing:
            Label("準備中…", systemImage: "hourglass")
                .foregroundStyle(.secondary)
        case .uploading(let ratio):
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("アップロード中…")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(Int((ratio * 100).rounded()))%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                ProgressView(value: ratio)
                    .tint(DopaColor.accent)
            }
        case .committing:
            Label("変換を開始しています…", systemImage: "gearshape.2")
                .foregroundStyle(.secondary)
        case .done:
            VStack(alignment: .leading, spacing: 6) {
                Label("アップロード完了！", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.subheadline.weight(.semibold))
                Text("サーバーで変換中です。完了するとライブラリに表示され、再生できるようになります。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("閉じる") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .tint(DopaColor.accent)
                    .foregroundStyle(.black)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 6) {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.footnote)
                Button("もう一度試す") {
                    manager.reset()
                }
                .font(.footnote.weight(.semibold))
            }
        }
    }

    private static var allowedTypes: [UTType] {
        var types: [UTType] = [.audio, .mp3, .mpeg4Audio, .wav]
        for identifier in ["org.xiph.flac", "org.xiph.ogg", "org.xiph.opus"] {
            if let type = UTType(identifier) {
                types.append(type)
            }
        }
        return types
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}
