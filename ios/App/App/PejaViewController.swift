import UIKit
import Capacitor

class PejaViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Enable iOS swipe-back gesture
        bridge?.webView?.allowsBackForwardNavigationGestures = true
    }
}
