import React from 'react';
import { Modal as RNModal, View, type ModalProps } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { markUserActivity } from '../lib/activity';

/**
 * React Native's Modal, with touches inside it counted as user activity for
 * auto-lock. A Modal renders in its own native root, outside the app root
 * view whose onTouchStart records activity, so without this a user busy in a
 * sheet would look idle. The full-size wrapper View lays children out exactly
 * as the Modal's own root does.
 *
 * Each Modal also gets its own SafeAreaProvider. A SafeAreaView takes its
 * insets from the nearest provider, and iOS detaches the screen underneath a
 * full-screen modal once it is presented — the app root's provider then
 * reports zero insets, so modal headers drew under the status bar.
 */
export function Modal({ children, ...props }: ModalProps): React.JSX.Element {
  return (
    <RNModal {...props}>
      <View style={{ flex: 1 }} onTouchStart={markUserActivity}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>{children}</SafeAreaProvider>
      </View>
    </RNModal>
  );
}
