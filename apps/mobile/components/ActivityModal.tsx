import React from 'react';
import { Modal as RNModal, View, type ModalProps } from 'react-native';
import { markUserActivity } from '../lib/activity';

/**
 * React Native's Modal, with touches inside it counted as user activity for
 * auto-lock. A Modal renders in its own native root, outside the app root
 * view whose onTouchStart records activity, so without this a user busy in a
 * sheet would look idle. The full-size wrapper View lays children out exactly
 * as the Modal's own root does.
 */
export function Modal({ children, ...props }: ModalProps): React.JSX.Element {
  return (
    <RNModal {...props}>
      <View style={{ flex: 1 }} onTouchStart={markUserActivity}>{children}</View>
    </RNModal>
  );
}
