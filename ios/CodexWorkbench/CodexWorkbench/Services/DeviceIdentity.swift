import Foundation
import UIKit

enum DeviceIdentity {
    static var defaultName: String {
        UIDevice.current.name.isEmpty ? "iPhone" : UIDevice.current.name
    }

    static var fingerprint: String {
        [
            UIDevice.current.identifierForVendor?.uuidString ?? "unknown-vendor",
            UIDevice.current.systemName,
            UIDevice.current.systemVersion,
            UIDevice.current.model
        ].joined(separator: "|")
    }
}
