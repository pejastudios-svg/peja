import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // Enable swipe-back gesture — try multiple times to ensure bridge is ready
        enableSwipeBack(attempts: 0)
        
        return true
    }
    
    private func enableSwipeBack(attempts: Int) {
        guard attempts < 10 else { return }
        
        let delay = attempts == 0 ? 0.5 : 1.0
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            
            // Try to find the web view through the view hierarchy
            if let rootVC = self.window?.rootViewController {
                if let bridgeVC = rootVC as? CAPBridgeViewController,
                   let webView = bridgeVC.bridge?.webView {
                    webView.allowsBackForwardNavigationGestures = true
                    return
                }
                
                // Search child view controllers
                for child in rootVC.children {
                    if let bridgeVC = child as? CAPBridgeViewController,
                       let webView = bridgeVC.bridge?.webView {
                        webView.allowsBackForwardNavigationGestures = true
                        return
                    }
                }
                
                // Search for WKWebView in view hierarchy
                if let webView = self.findWebView(in: rootVC.view) {
                    webView.allowsBackForwardNavigationGestures = true
                    return
                }
            }
            
            // Retry if not found yet
            self.enableSwipeBack(attempts: attempts + 1)
        }
    }
    
    private func findWebView(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView {
            return webView
        }
        for subview in view.subviews {
            if let found = findWebView(in: subview) {
                return found
            }
        }
        return nil
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}