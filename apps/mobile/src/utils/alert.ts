import { Platform, Alert as RNAlert } from 'react-native';

interface AlertButton {
  text: string;
  onPress?: () => void;
}

/**
 * Cross-platform alert that works on native (Alert.alert) and web (window.alert / window.confirm).
 * On web, simple alerts use window.alert; alerts with buttons use window.confirm for the first action.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS === 'web') {
    const fullMessage = message ? `${title}\n\n${message}` : title;

    if (!buttons || buttons.length === 0) {
      window.alert(fullMessage);
      return;
    }

    // For alerts with actions, use confirm for the primary action
    const primaryButton = buttons.find((b) => b.onPress) || buttons[0];
    const confirmMessage = `${title}${message ? '\n\n' + message : ''}\n\nPress OK to continue.`;

    if (buttons.length <= 1) {
      window.alert(fullMessage);
      primaryButton?.onPress?.();
      return;
    }

    // Multiple buttons — use confirm for primary action
    const confirmed = window.confirm(confirmMessage);
    if (confirmed) {
      primaryButton?.onPress?.();
    }
  } else {
    RNAlert.alert(title, message, buttons);
  }
}