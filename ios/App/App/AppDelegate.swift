import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // Set dark background on window
        let darkColor = UIColor(red: 12/255, green: 8/255, blue: 24/255, alpha: 1.0)
        window?.backgroundColor = darkColor
        
        // Disable native swipe-back (we handle it in JS)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.configureWebView()
        }
        
        return true
    }
    
    private func configureWebView() {
        guard let rootVC = window?.rootViewController else { return }
        
        if let webView = findWebView(in: rootVC.view) {
            webView.allowsBackForwardNavigationGestures = false
            
            let darkColor = UIColor(red: 12/255, green: 8/255, blue: 24/255, alpha: 1.0)
            webView.isOpaque = false
            webView.backgroundColor = darkColor
            webView.scrollView.backgroundColor = darkColor
            webView.superview?.backgroundColor = darkColor
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