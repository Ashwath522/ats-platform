# WebView Integration Contract for Interface (Flutter App)

This document describes how the Flutter/Dart mobile app (`Interface`) should embed and interact with this React-based ATS Platform via WebView.

---

## 1. Embedded Target URL
The primary landing route for the candidate experience is:
- **Production URL**: `https://<domain>/candidate/feed`
- **Development URL**: `http://localhost:5173/candidate/feed`

---

## 2. Authentication Protocol (Token Passing)
To ensure seamless single-sign-on (SSO), the Flutter app must pass the candidate's JWT authentication token to the WebView.

We establish the **URL Query Parameter** contract as the primary injection method.

### How to embed the WebView in Flutter:
1. Obtain the candidate's JWT token within Flutter.
2. Initialize the WebView with the token appended to the query parameter:
   ```
   https://<domain>/candidate/feed?token=<JWT_TOKEN_HERE>
   ```
3. The React app will automatically:
   - Extract the `token` parameter from the URL.
   - Parse and validate the token.
   - Save the token to local storage (`candidateToken`).
   - Clean up the URL query parameters using HTML5 History API to prevent token exposure.
   - Authorize the session.

---

## 3. Responsive Constraints
- The React web app is fully optimized for mobile devices, adapting dynamically to viewport widths as narrow as `320px`.
- Native browser scrolling is used throughout. No custom desktop scrollbars or mouse-only triggers are used, providing a native-app feel.
- Safe Area Insets (`padding-bottom: env(safe-area-inset-bottom)`) are automatically applied to the bottom navigation bar to support iPhone/Android bezel-less screen regions.

---

## 4. WebView Configuration (Flutter)
When instantiating the WebView widget in Dart, please ensure:
- `javascriptMode: JavascriptMode.unrestricted` (must be enabled for React router and token handshake).
- `domStorageEnabled: true` (required for local storage persistence).
- Support for file inputs (necessary for uploading PDF/DOCX resumes). In Flutter's `webview_flutter`, this might require handling file chooser requests using plugins or native bindings if standard file upload triggers are blocked by the OS.
