/**
 * Polyfill for the Web Crypto API in React Native.
 *
 * The `uuid` package (v14+) requires `crypto.getRandomValues()` which
 * doesn't exist in React Native's Hermes engine. This polyfill must be
 * imported BEFORE any code that uses `uuid`.
 *
 * Import this at the very top of the app entry point (_layout.tsx).
 */
import 'react-native-get-random-values';