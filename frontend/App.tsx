import { useState } from 'react';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { LUMS_CENTER, MAP_STYLE_URL } from './src/mapConfig';

const demoGames = [
  { id: 'football', sport: 'Football', title: 'Football pickup', coordinates: [74.4079, 31.4708] as [number, number], spots: 4 },
  { id: 'cricket', sport: 'Tape-ball', title: 'Tape-ball cricket', coordinates: [74.4092, 31.4699] as [number, number], spots: 3 },
];

export default function App() {
  const [selectedGame, setSelectedGame] = useState<(typeof demoGames)[number] | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Map
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        onDidFailLoadingMap={() => setMapFailed(true)}
        onDidFinishLoadingStyle={() => setMapFailed(false)}
      >
        <Camera initialViewState={{ center: LUMS_CENTER, zoom: 16, pitch: 35 }} />
        {demoGames.map((game) => (
          <Marker key={game.id} id={game.id} lngLat={game.coordinates} onPress={() => setSelectedGame(game)}>
            <View style={styles.marker}>
              <Text style={styles.markerText}>{game.spots} spots</Text>
            </View>
          </Marker>
        ))}
      </Map>

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>CAMPUS PICKUP · LUMS</Text>
          <Text style={styles.heading}>Games on the map</Text>
          <Text style={styles.note}>Sample pins for testing MapLibre</Text>
        </View>

        {mapFailed && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Map could not load</Text>
            <Text style={styles.cardBody}>Check your internet connection and map style URL.</Text>
          </View>
        )}

        {selectedGame && (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.sport}>{selectedGame.sport}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close game details" onPress={() => setSelectedGame(null)}>
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.cardTitle}>{selectedGame.title}</Text>
            <Text style={styles.cardBody}>{selectedGame.spots} spots left · Demo game</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f5f0' },
  map: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  header: { backgroundColor: '#f4f5f0', marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 16 },
  eyebrow: { color: '#1d5b3a', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  heading: { color: '#15201b', fontSize: 26, fontWeight: '800', marginTop: 5 },
  note: { color: '#526258', fontSize: 13, marginTop: 4 },
  marker: { backgroundColor: '#e3342f', borderColor: '#f4f5f0', borderRadius: 18, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 7 },
  markerText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  card: { backgroundColor: '#f4f5f0', borderRadius: 16, margin: 16, padding: 18 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  sport: { color: '#1d5b3a', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  close: { color: '#1d5b3a', fontSize: 13, fontWeight: '700' },
  cardTitle: { color: '#15201b', fontSize: 22, fontWeight: '800', marginTop: 6 },
  cardBody: { color: '#526258', fontSize: 15, marginTop: 4 },
});
