import SwiftUI
#if os(iOS)
import UIKit
typealias ArtworkImage = UIImage
#else
import AppKit
typealias ArtworkImage = NSImage
#endif

/// アートワーク画像のキャッシュ（スクロールや画面遷移のたびに再取得しない）
final class ArtworkCache {
    static let shared = ArtworkCache()

    private let cache = NSCache<NSString, ArtworkImage>()

    private init() {
        cache.countLimit = 200
    }

    func image(for url: URL) async -> ArtworkImage? {
        let key = url.absoluteString as NSString
        if let cached = cache.object(forKey: key) {
            return cached
        }
        guard let data = await APIClient.shared.fetchData(url),
            let image = ArtworkImage(data: data)
        else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// AsyncImageのキャッシュ版
struct CachedArtwork<Placeholder: View>: View {
    let url: URL?
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: ArtworkImage?

    var body: some View {
        Group {
            if let image {
                platformImage(image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            image = nil
            guard let url else { return }
            image = await ArtworkCache.shared.image(for: url)
        }
    }

    @ViewBuilder
    private func platformImage(_ image: ArtworkImage) -> Image {
        #if os(iOS)
        Image(uiImage: image)
        #else
        Image(nsImage: image)
        #endif
    }
}
