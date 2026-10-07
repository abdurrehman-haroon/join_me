import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { checkApiHealth } from './src/api';

type ApiState = 'checking' | 'online' | 'offline';

export default function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');

  async function refreshStatus() {
    setApiState('checking');
    try {
      await checkApiHealth();
      setApiState('online');
    } catch {
      setApiState('offline');
    }
  }

  useEffect(() => {
    let active = true;
    checkApiHealth()
      .then(() => { if (active) setApiState('online'); })
      .catch(() => { if (active) setApiState('offline'); });
    return () => { active = false; };
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>CAMPUS PICKUP</Text>
        <Text style={styles.title}>Find your next game.</Text>
        <Text style={styles.subtitle}>Football and tape-ball cricket with people on your campus.</Text>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Games nearby</Text>
          <Text style={styles.panelBody}>No games to show yet. Game pins and campus verification are next.</Text>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusText}>
            <Text style={styles.statusLabel}>API connection</Text>
            <Text style={styles.statusValue}>
              {apiState === 'checking' ? 'Checking…' : apiState === 'online' ? 'Connected' : 'Unavailable'}
            </Text>
          </View>
          {apiState === 'checking' ? (
            <ActivityIndicator color="#145c48" />
          ) : (
            <Pressable accessibilityRole="button" onPress={() => void refreshStatus()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f5ef' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 54 },
  eyebrow: { color: '#145c48', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#17251e', fontSize: 38, fontWeight: '800', marginTop: 18 },
  subtitle: { color: '#526258', fontSize: 17, lineHeight: 25, marginTop: 14 },
  panel: { backgroundColor: '#fff', borderRadius: 20, marginTop: 40, padding: 24 },
  panelTitle: { color: '#17251e', fontSize: 21, fontWeight: '700' },
  panelBody: { color: '#526258', fontSize: 16, lineHeight: 24, marginTop: 12 },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  statusText: { flex: 1 },
  statusLabel: { color: '#526258', fontSize: 13 },
  statusValue: { color: '#17251e', fontSize: 16, fontWeight: '600', marginTop: 3 },
  retryButton: { borderColor: '#145c48', borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: '#145c48', fontWeight: '700' },
});
