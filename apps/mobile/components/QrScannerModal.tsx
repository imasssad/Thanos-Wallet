/**
 * Full-screen QR scanner for the mobile wallet.
 *
 * Wraps expo-camera's CameraView. Handles the three permission states
 * (undetermined → ask, denied → settings hint, granted → live camera).
 * Emits the decoded payload exactly once per open via `onResult`, then
 * the parent closes the modal.
 *
 * Used by the Send screen (scan a recipient address) and — once mobile
 * WalletConnect lands — the WC pairing flow (scan a wc: URI). The
 * caller decides what the payload means; this component just decodes.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet, Linking, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X } from 'lucide-react-native';

interface Props {
  visible:  boolean;
  onClose:  () => void;
  /** Fires once with the raw scanned string. Parent normalises it. */
  onResult: (data: string) => void;
  /** Optional heading copy — e.g. "Scan recipient" or "Scan WalletConnect QR". */
  title?:   string;
}

export function QrScannerModal({ visible, onClose, onResult, title = 'Scan QR code' }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  /* Guard against expo-camera firing onBarcodeScanned dozens of times
     per second — we want exactly one result per modal open. */
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (visible) setHandled(false);
  }, [visible]);

  // Auto-prompt for permission the first time the modal opens.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const handleScan = (data: string) => {
    if (handled || !data) return;
    setHandled(true);
    onResult(data);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root}>
        {/* Camera or permission state */}
        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff"/>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.permTitle}>Camera access needed</Text>
            <Text style={styles.permBody}>
              Thanos Wallet needs the camera to scan QR codes. {permission.canAskAgain
                ? 'Tap below to allow access.'
                : 'Enable camera access for Thanos Wallet in your device settings.'}
            </Text>
            <Pressable
              style={styles.permBtn}
              onPress={() => {
                if (permission.canAskAgain) void requestPermission();
                else void Linking.openSettings();
              }}
            >
              <Text style={styles.permBtnText}>
                {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handled ? undefined : ({ data }) => handleScan(data)}
          />
        )}

        {/* Scan-frame overlay (only over a live camera) */}
        {permission?.granted && (
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.tl]}/>
              <View style={[styles.corner, styles.tr]}/>
              <View style={[styles.corner, styles.bl]}/>
              <View style={[styles.corner, styles.br]}/>
            </View>
            <Text style={styles.hint}>Point the camera at a QR code</Text>
          </View>
        )}

        {/* Header — title + close, always on top */}
        <View style={styles.header} pointerEvents="box-none">
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={16} style={styles.closeBtn}>
            <X size={22} color="#fff" strokeWidth={2.4}/>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const ACCENT = '#3b7af7';

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },

  permTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permBody:  { color: '#bbb', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  permBtn:   { marginTop: 8, backgroundColor: ACCENT, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 12 },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame:   { width: 248, height: 248 },
  corner:  { position: 'absolute', width: 34, height: 34, borderColor: ACCENT },
  tl: { top: 0, left: 0,  borderTopWidth: 4,    borderLeftWidth: 4 },
  tr: { top: 0, right: 0, borderTopWidth: 4,    borderRightWidth: 4 },
  bl: { bottom: 0, left: 0,  borderBottomWidth: 4, borderLeftWidth: 4 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  hint: { color: '#fff', fontSize: 13, marginTop: 28, opacity: 0.85 },

  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 54, paddingHorizontal: 18, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title:    { color: '#fff', fontSize: 17, fontWeight: '700' },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
