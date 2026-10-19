import SwiftUI

/// ダウンロード済みの曲（オフライン再生・管理）
struct DownloadsView: View {
    @EnvironmentObject private var player: PlayerEngine
    @ObservedObject private var downloads = DownloadStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if downloads.records.isEmpty {
                    ContentUnavailableView(
                        "ダウンロードした曲がありません",
                        systemImage: "arrow.down.circle",
                        description: Text("ライブラリの曲を長押し →「ダウンロード」で保存できます")
                    )
                } else {
                    list
                }
            }
            .background(DopaColor.background)
            .navigationTitle("ダウンロード済み")
            .dopaInlineTitle()
            .toolbar {
                ToolbarItem(placement: .dopaTrailing) {
                    Button("閉じる") { dismiss() }
                }
            }
        }
    }

    private var list: some View {
        List {
            Section {
                ForEach(downloads.records) { record in
                    Button {
                        playFrom(record)
                    } label: {
                        TrackRowView(
                            title: record.title,
                            artist: record.artist,
                            artworkURL: nil,
                            durationSec: record.durationSec,
                            subtitleSuffix: "\(formatBytes(record.sizeBytes))・オフライン",
                            isCurrent: player.currentTrack?.id == record.trackId,
                            isPlaying: player.isPlaying
                        )
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(DopaColor.background)
                    .listRowSeparatorTint(DopaColor.border)
                    .swipeActions {
                        Button(role: .destructive) {
                            downloads.delete(record.trackId)
                        } label: {
                            Label("削除", systemImage: "trash")
                        }
                    }
                }
            } footer: {
                Text("合計 \(formatBytes(downloads.totalSizeBytes))")
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func playFrom(_ record: DownloadRecord) {
        let records = downloads.records
        guard let index = records.firstIndex(where: { $0.trackId == record.trackId }) else { return }
        player.play(tracks: records.map { downloads.toPlayerTrack($0) }, startAt: index)
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}
