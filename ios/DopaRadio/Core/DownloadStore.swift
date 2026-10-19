import Foundation

/// ダウンロード済みの記録
struct DownloadRecord: Codable, Identifiable {
    let trackId: String
    let title: String
    let artist: String?
    let durationSec: Int?
    let chorusStartSec: Int?
    let chorusEndSec: Int?
    let fileName: String
    let sizeBytes: Int64
    let downloadedAt: Date

    var id: String { trackId }
}

/// 曲のオフライン保存（端末内に保存してオフライン再生を可能にする）
final class DownloadStore: NSObject, ObservableObject {
    static let shared = DownloadStore()

    @Published private(set) var records: [DownloadRecord] = []
    /// ダウンロード中の進捗（trackId → 0..1）
    @Published private(set) var progress: [String: Double] = [:]
    @Published private(set) var failedTrackIds: Set<String> = []

    private struct PendingMeta {
        let trackId: String
        let title: String
        let artist: String?
        let durationSec: Int?
        let chorusStartSec: Int?
        let chorusEndSec: Int?
    }

    private let directory: URL
    private lazy var session: URLSession = URLSession(
        configuration: .default, delegate: self, delegateQueue: nil
    )
    private var pending: [Int: PendingMeta] = [:]

    private override init() {
        directory = FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DopaDownloads", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        loadIndex()
    }

    // MARK: - 参照

    func localURL(for trackId: String) -> URL? {
        guard let record = records.first(where: { $0.trackId == trackId }) else { return nil }
        let url = directory.appendingPathComponent(record.fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func isDownloaded(_ trackId: String) -> Bool {
        localURL(for: trackId) != nil
    }

    func isDownloading(_ trackId: String) -> Bool {
        progress[trackId] != nil
    }

    var totalSizeBytes: Int64 {
        records.reduce(0) { $0 + $1.sizeBytes }
    }

    // MARK: - ダウンロード開始

    func download(trackId: String, title: String, artist: String?, durationSec: Int?, chorusStartSec: Int?, chorusEndSec: Int?) {
        guard !isDownloaded(trackId), progress[trackId] == nil else { return }
        guard let url = URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(trackId)/file") else { return }

        var request = URLRequest(url: url)
        request.setValue("DOPA-radio-iOS", forHTTPHeaderField: "User-Agent")

        failedTrackIds.remove(trackId)
        progress[trackId] = 0

        let task = session.downloadTask(with: request)
        pending[task.taskIdentifier] = PendingMeta(
            trackId: trackId,
            title: title,
            artist: artist,
            durationSec: durationSec,
            chorusStartSec: chorusStartSec,
            chorusEndSec: chorusEndSec
        )
        task.resume()
    }

    func download(_ track: TrackDTO) {
        download(
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            durationSec: track.durationSec,
            chorusStartSec: track.chorusStartSec,
            chorusEndSec: track.chorusEndSec
        )
    }

    func download(_ track: SavedTrackDTO) {
        download(
            trackId: track.trackId,
            title: track.title,
            artist: track.artist,
            durationSec: track.durationSec,
            chorusStartSec: track.chorusStartSec,
            chorusEndSec: track.chorusEndSec
        )
    }

    func delete(_ trackId: String) {
        guard let record = records.first(where: { $0.trackId == trackId }) else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(record.fileName))
        records.removeAll { $0.trackId == trackId }
        saveIndex()
    }

    func toPlayerTrack(_ record: DownloadRecord, includeArtwork: Bool = true) -> PlayerTrack {
        PlayerTrack(
            id: record.trackId,
            title: record.title,
            artist: record.artist,
            durationSec: record.durationSec,
            artworkURL: includeArtwork
                ? URL(string: "\(APIClient.baseURL.absoluteString)/api/tracks/\(record.trackId)/artwork")
                : nil,
            chorusStartSec: record.chorusStartSec,
            chorusEndSec: record.chorusEndSec,
            localURL: localURL(for: record.trackId),
            directURL: nil
        )
    }

    // MARK: - インデックス

    private func loadIndex() {
        let url = directory.appendingPathComponent("index.json")
        guard let data = try? Data(contentsOf: url),
            let list = try? JSONDecoder().decode([DownloadRecord].self, from: data)
        else { return }
        records = list
    }

    private func saveIndex() {
        let url = directory.appendingPathComponent("index.json")
        if let data = try? JSONEncoder().encode(records) {
            try? data.write(to: url)
        }
    }
}

extension DownloadStore: URLSessionDownloadDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        Task { @MainActor in
            guard let meta = pending.removeValue(forKey: downloadTask.taskIdentifier) else { return }
            let fileName = "\(meta.trackId).m4a"
            let destination = directory.appendingPathComponent(fileName)
            do {
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.moveItem(at: location, to: destination)
                let attributes = try? FileManager.default.attributesOfItem(atPath: destination.path)
                let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
                let record = DownloadRecord(
                    trackId: meta.trackId,
                    title: meta.title,
                    artist: meta.artist,
                    durationSec: meta.durationSec,
                    chorusStartSec: meta.chorusStartSec,
                    chorusEndSec: meta.chorusEndSec,
                    fileName: fileName,
                    sizeBytes: size,
                    downloadedAt: Date()
                )
                records.removeAll { $0.trackId == meta.trackId }
                records.insert(record, at: 0)
                saveIndex()
            } catch {
                failedTrackIds.insert(meta.trackId)
            }
            progress[meta.trackId] = nil
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let ratio = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        Task { @MainActor in
            if let trackId = pending[downloadTask.taskIdentifier]?.trackId {
                progress[trackId] = ratio
            }
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard error != nil else { return }
        Task { @MainActor in
            if let meta = pending.removeValue(forKey: task.taskIdentifier) {
                failedTrackIds.insert(meta.trackId)
                progress[meta.trackId] = nil
            }
        }
    }
}
