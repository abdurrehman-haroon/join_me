import { useFonts } from "expo-font";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import MapScreen from "./MapScreen";

type Tab = "map" | "games" | "cup" | "you";
type Panel = "game" | "create" | "chat" | "gameDay" | "campuses" | null;
type Game = {
  id: string;
  sport: "Football" | "Tape-ball";
  title: string;
  ground: string;
  time: string;
  players: number;
  capacity: number;
  host: string;
  joined?: boolean;
};

const fixtures: Game[] = [
  {
    id: "tape",
    sport: "Tape-ball",
    title: "Tape-ball, 8 overs",
    ground: "Main cricket ground",
    time: "7:15 pm",
    players: 13,
    capacity: 16,
    host: "Daniyal Hussain",
    joined: true,
  },
  {
    id: "turf",
    sport: "Football",
    title: "7-a-side football",
    ground: "Sports Complex turf",
    time: "7:30 pm",
    players: 10,
    capacity: 14,
    host: "Hamza Rauf",
  },
  {
    id: "lawn",
    sport: "Football",
    title: "5-a-side football",
    ground: "M-5 hostel lawn",
    time: "8:00 pm",
    players: 10,
    capacity: 10,
    host: "Shayan Iqbal",
  },
  {
    id: "ground",
    sport: "Football",
    title: "11-a-side football",
    ground: "Football ground",
    time: "9:30 pm",
    players: 9,
    capacity: 22,
    host: "Ahmed Saeed",
  },
];

const colors = {
  ink: "#15201B",
  chalk: "#F4F5F0",
  muted: "#6C786E",
  red: "#F3192C",
};

function Label({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

function Pill({
  text,
  active,
  onPress,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Label style={active ? styles.pillTextActive : styles.pillText}>
        {text}
      </Label>
    </Pressable>
  );
}

function Button({
  text,
  onPress,
  light = false,
}: {
  text: string;
  onPress: () => void;
  light?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, light && styles.buttonLight]}
    >
      <Label style={[styles.buttonText, light && styles.buttonTextLight]}>
        {text}
      </Label>
    </Pressable>
  );
}

function GameCard({ game, onPress }: { game: Game; onPress: () => void }) {
  const free = game.capacity - game.players;
  return (
    <Pressable onPress={onPress} style={styles.gameCard}>
      <View style={styles.row}>
        <Label style={styles.eyebrow}>{game.ground.toUpperCase()}</Label>
        <Label>{game.time}</Label>
      </View>
      <Text style={styles.cardTitle}>{game.title}</Text>
      <Label style={styles.muted}>Hosted by {game.host}</Label>
      <View style={[styles.row, { marginTop: 22 }]}>
        <Label>
          {game.players} of {game.capacity} players
        </Label>
        <View style={styles.spots}>
          <Label style={{ fontWeight: "800" }}>
            {free ? `${free} spots left` : "Full"}
          </Label>
        </View>
      </View>
    </Pressable>
  );
}

export default function NativeApp() {
  const [loaded] = useFonts({
    BigShoulders: require("../assets/BigShouldersDisplayBlack.ttf"),
  });
  const [tab, setTab] = useState<Tab>("map");
  const [panel, setPanel] = useState<Panel>(null);
  const [games, setGames] = useState(fixtures);
  const [selectedId, setSelectedId] = useState(fixtures[0].id);
  const [createSport, setCreateSport] = useState<"Football" | "Tape-ball">(
    "Football",
  );
  const [ground, setGround] = useState("Sports Complex turf");
  const [time, setTime] = useState("7:30 pm");
  const [capacity, setCapacity] = useState(14);
  const [visibility, setVisibility] = useState("Everyone at LUMS");
  const [weekly, setWeekly] = useState(false);
  const [available, setAvailable] = useState(true);
  const [positions, setPositions] = useState(["Midfield", "Off-spin"]);
  const [freeDays, setFreeDays] = useState(["Tue evening", "Thu evening"]);
  const [calm, setCalm] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [gameDayStep, setGameDayStep] = useState("Check-in");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    "Hamza: See you at the ground!",
    "Daniyal: I can bring the ball.",
  ]);
  const [cupView, setCupView] = useState("Standings");

  if (!loaded) return null;
  const selected = games.find((game) => game.id === selectedId) ?? games[0];

  function openGame(game: Game) {
    setSelectedId(game.id);
    setPanel("game");
  }
  function toggleJoin() {
    setGames((current) =>
      current.map((game) =>
        game.id === selectedId
          ? {
              ...game,
              joined: !game.joined,
              players: game.players + (game.joined ? -1 : 1),
            }
          : game,
      ),
    );
  }
  function createGame() {
    const game: Game = {
      id: String(Date.now()),
      sport: createSport,
      title:
        createSport === "Football"
          ? `${capacity / 2}-a-side football`
          : "Tape-ball cricket",
      ground,
      time,
      players: 1,
      capacity,
      host: "Ali Awan",
      joined: true,
    };
    setGames((current) => [...current, game]);
    openGame(game);
  }

  return (
    <View style={styles.root}>
      {tab === "map" && <MapScreen />}
      {tab !== "map" && (
        <Label style={{ textAlign: "center", marginTop: 60 }}>
          Prototype preview · sample data
        </Label>
      )}

      {tab === "games" && (
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.pageContent}
        >
          <Text style={styles.pageTitle}>Your games</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Label style={styles.heading}>I’m free to play</Label>
              <Switch
                value={available}
                onValueChange={setAvailable}
                trackColor={{ true: "#398652" }}
              />
            </View>
            <Label style={styles.muted}>
              When a game that fits you is one or two players short, you get one
              ping. Never more than one a day.
            </Label>
            <View style={styles.chips}>
              {["Midfield", "Defence", "Off-spin"].map((name) => (
                <Pill
                  key={name}
                  text={name}
                  active={positions.includes(name)}
                  onPress={() =>
                    setPositions((current) =>
                      current.includes(name)
                        ? current.filter((position) => position !== name)
                        : [...current, name],
                    )
                  }
                />
              ))}
            </View>
            <View style={styles.chips}>
              {["Tue evening", "Thu evening", "Weekend"].map((name) => (
                <Pill
                  key={name}
                  text={name}
                  active={freeDays.includes(name)}
                  onPress={() =>
                    setFreeDays((current) =>
                      current.includes(name)
                        ? current.filter((day) => day !== name)
                        : [...current, name],
                    )
                  }
                />
              ))}
            </View>
          </View>
          <Label style={styles.listTitle}>Coming up</Label>
          {games
            .filter((game) => game.joined)
            .map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onPress={() => openGame(game)}
              />
            ))}
          <Label style={styles.listTitle}>Regulars</Label>
          <View style={styles.card}>
            <Label style={styles.heading}>The Thursday tape-ball crew</Label>
            <Label style={styles.muted}>
              Main cricket ground · Thursdays at 7:15 pm
            </Label>
          </View>
        </ScrollView>
      )}

      {tab === "cup" && (
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.pageContent}
        >
          <Text style={styles.pageTitle}>Hostel Cup</Text>
          <Label style={styles.muted}>
            Fall 2026. Every game you turn up to earns points for your hostel.
          </Label>
          <View style={styles.podium}>
            <Text style={styles.podiumTitle}>HOSTEL CUP</Text>
            <View style={styles.podiumBars}>
              <View style={[styles.podiumBar, { height: 65 }]} />
              <View
                style={[
                  styles.podiumBar,
                  { height: 115, backgroundColor: "#EFC06B" },
                ]}
              />
              <View style={[styles.podiumBar, { height: 50 }]} />
            </View>
            <Label style={{ color: "#fff" }}>Top three this semester</Label>
          </View>
          <View style={styles.chips}>
            {["Standings", "Night Series"].map((name) => (
              <Pill
                key={name}
                text={name}
                active={cupView === name}
                onPress={() => setCupView(name)}
              />
            ))}
          </View>
          {cupView === "Standings" ? (
            ["M-3", "M-5", "M-1", "F-2"].map((name, index) => (
              <View key={name} style={styles.standing}>
                <Label style={styles.heading}>
                  {index + 1} {name}
                </Label>
                <Label style={styles.heading}>
                  {[164, 139, 112, 87][index]} pts
                </Label>
              </View>
            ))
          ) : (
            <View style={styles.card}>
              <Label style={styles.heading}>Night Series</Label>
              <Label style={styles.muted}>Semi-finals and final</Label>
            </View>
          )}
          <View style={styles.card}>
            <Label style={styles.heading}>How points work</Label>
            {[
              "Play in a game that happens  +10",
              "Host a game that happens  +15",
              "Bring the kit  +3",
              "Win  +5",
              "Join and don’t turn up  −10",
            ].map((rule) => (
              <Label key={rule} style={styles.rule}>
                {rule}
              </Label>
            ))}
          </View>
        </ScrollView>
      )}

      {tab === "you" && (
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.pageContent}
        >
          <View style={styles.playerCard}>
            <View style={styles.row}>
              <Label style={styles.playerText}>LUMS</Label>
              <Label style={styles.playerText}>Fall 2026</Label>
            </View>
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
              <Text style={styles.playerNumber}>14</Text>
              <Text style={styles.playerName}>Ali Awan</Text>
              <Label style={styles.playerText}>
                M-3 hostel. Midfield, off-spin.
              </Label>
            </View>
            <View style={styles.row}>
              {[
                ["14", "Played"],
                ["13", "Turned up"],
                ["3", "Hosted"],
                ["164", "Cup pts"],
              ].map(([count, name]) => (
                <View key={name}>
                  <Label style={styles.playerText}>{count}</Label>
                  <Label style={styles.playerText}>{name}</Label>
                </View>
              ))}
            </View>
          </View>
          <Pressable
            style={styles.setting}
            onPress={() => setPanel("campuses")}
          >
            <Label>Campus</Label>
            <Label style={styles.muted}>LUMS, verified ›</Label>
          </Pressable>
          <Label style={styles.listTitle}>Notifications</Label>
          {[
            "Someone joined your game",
            "One spot left",
            "Starts in 30 minutes",
            "A game needs you",
          ].map((name) => (
            <View key={name} style={styles.setting}>
              <Label>{name}</Label>
              <Switch value trackColor={{ true: "#398652" }} />
            </View>
          ))}
          <View style={styles.setting}>
            <Label>Calm motion</Label>
            <Switch
              value={calm}
              onValueChange={setCalm}
              trackColor={{ true: "#398652" }}
            />
          </View>
          <View style={styles.setting}>
            <Label>Blocked people</Label>
            <Label style={styles.muted}>None ›</Label>
          </View>
        </ScrollView>
      )}

      <View style={styles.tabBar}>
        {(
          [
            ["map", "◇", "Map"],
            ["games", "▣", "Your games"],
            ["cup", "♜", "Hostel Cup"],
            ["you", "♙", "You"],
          ] as const
        ).map(([key, icon, name]) => (
          <Pressable
            key={key}
            onPress={() => {
              setTab(key);
              setPanel(null);
            }}
            style={styles.tabButton}
          >
            <Text style={[styles.tabIcon, tab === key && styles.activeTab]}>
              {icon}
            </Text>
            <Label style={[styles.tabLabel, tab === key && styles.activeTab]}>
              {name}
            </Label>
          </Pressable>
        ))}
      </View>

      <Modal
        transparent
        visible={panel !== null}
        animationType="slide"
        onRequestClose={() => setPanel(null)}
      >
        <View style={styles.modal}>
          <Pressable style={styles.scrim} onPress={() => setPanel(null)} />
          <View
            style={[
              styles.sheet,
              panel !== "game" && panel !== "create" && styles.fullSheet,
            ]}
          >
            <Pressable onPress={() => setPanel(null)} style={styles.grab}>
              <View style={styles.handle} />
            </Pressable>
            <ScrollView
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
            >
              {panel === "game" && (
                <>
                  <Label style={styles.eyebrow}>
                    {selected.ground.toUpperCase()} · {selected.time}
                  </Label>
                  <Text style={styles.sheetTitle}>{selected.title}</Text>
                  <View style={styles.spotBanner}>
                    <Text style={styles.spotNumber}>
                      {selected.capacity - selected.players}
                    </Text>
                    <Label>spots left of {selected.capacity}</Label>
                  </View>
                  <Label style={styles.listTitle}>The game</Label>
                  <Label style={styles.muted}>
                    Hosted by {selected.host} · {selected.ground}
                  </Label>
                  <Label style={styles.listTitle}>
                    Players · {selected.players}/{selected.capacity}
                  </Label>
                  <View style={styles.roster}>
                    {Array.from({ length: selected.players }, (_, index) => (
                      <View key={index} style={styles.rosterDot}>
                        <Label style={{ color: "#fff" }}>
                          {index ? "●" : "AA"}
                        </Label>
                      </View>
                    ))}
                  </View>
                  <Button
                    text={
                      selected.joined
                        ? "Leave game"
                        : selected.players >= selected.capacity
                          ? "Game full"
                          : "Join game"
                    }
                    onPress={toggleJoin}
                    light={
                      selected.joined || selected.players >= selected.capacity
                    }
                  />
                  <Button
                    text="Open game chat"
                    light
                    onPress={() => setPanel("chat")}
                  />
                  <Button
                    text="Game Day"
                    light
                    onPress={() => setPanel("gameDay")}
                  />
                </>
              )}
              {panel === "create" && (
                <>
                  <Text style={styles.sheetTitle}>Start a game</Text>
                  <Label style={styles.fieldLabel}>Sport</Label>
                  <View style={styles.chips}>
                    {(["Football", "Tape-ball"] as const).map((name) => (
                      <Pill
                        key={name}
                        text={name}
                        active={createSport === name}
                        onPress={() => setCreateSport(name)}
                      />
                    ))}
                  </View>
                  <Label style={styles.fieldLabel}>Where</Label>
                  {[
                    "Sports Complex turf",
                    "Football ground",
                    "Main cricket ground",
                    "M-5 hostel lawn",
                  ].map((name) => (
                    <Pill
                      key={name}
                      text={name}
                      active={ground === name}
                      onPress={() => setGround(name)}
                    />
                  ))}
                  <Label style={styles.fieldLabel}>Kick-off</Label>
                  <View style={styles.chips}>
                    {["7:15 pm", "7:30 pm", "8:00 pm", "9:30 pm"].map(
                      (name) => (
                        <Pill
                          key={name}
                          text={name}
                          active={time === name}
                          onPress={() => setTime(name)}
                        />
                      ),
                    )}
                  </View>
                  <Label style={styles.fieldLabel}>Players</Label>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => setCapacity(Math.max(6, capacity - 2))}
                    >
                      <Label style={styles.stepButton}>−</Label>
                    </Pressable>
                    <View>
                      <Text style={styles.stepNumber}>{capacity}</Text>
                      <Label>{capacity / 2}-a-side</Label>
                    </View>
                    <Pressable
                      onPress={() => setCapacity(Math.min(22, capacity + 2))}
                    >
                      <Label style={styles.stepButton}>+</Label>
                    </Pressable>
                  </View>
                  <Label style={styles.fieldLabel}>Who can see it</Label>
                  {["Everyone at LUMS", "Women only", "Friends"].map((name) => (
                    <Pill
                      key={name}
                      text={name}
                      active={visibility === name}
                      onPress={() => setVisibility(name)}
                    />
                  ))}
                  <View style={styles.setting}>
                    <Label>Repeat every week</Label>
                    <Switch value={weekly} onValueChange={setWeekly} />
                  </View>
                  <Button text="Drop pin" onPress={createGame} />
                </>
              )}
              {panel === "chat" && (
                <>
                  <Text style={styles.sheetTitle}>Game chat</Text>
                  <Label style={styles.muted}>
                    {selected.title} · {selected.ground}
                  </Label>
                  {messages.map((entry, index) => (
                    <View key={index} style={styles.card}>
                      <Label>{entry}</Label>
                    </View>
                  ))}
                  <TextInput
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Message the players"
                    style={styles.input}
                  />
                  <Button
                    text="Send"
                    onPress={() => {
                      if (message.trim())
                        setMessages((current) => [
                          ...current,
                          `You: ${message.trim()}`,
                        ]);
                      setMessage("");
                    }}
                  />
                </>
              )}
              {panel === "gameDay" && (
                <>
                  <Text style={styles.sheetTitle}>Game Day</Text>
                  <Label style={styles.muted}>
                    {selected.title} · {selected.ground}
                  </Label>
                  <View style={styles.chips}>
                    {["Check-in", "Teams", "Toss", "Score", "Result"].map(
                      (name) => (
                        <Pill
                          key={name}
                          text={name}
                          active={name === gameDayStep}
                          onPress={() => setGameDayStep(name)}
                        />
                      ),
                    )}
                  </View>
                  {gameDayStep === "Check-in" ? (
                    <View style={styles.card}>
                      <Label style={styles.heading}>
                        {checkedIn
                          ? "You’re checked in"
                          : "Check in at the ground"}
                      </Label>
                      <Label style={styles.muted}>
                        Players check in so the game and Cup points count.
                      </Label>
                    </View>
                  ) : (
                    <View style={styles.card}>
                      <Label style={styles.heading}>{gameDayStep}</Label>
                      <Label style={styles.muted}>
                        Game Day details will appear when this game reaches{" "}
                        {gameDayStep.toLowerCase()}.
                      </Label>
                    </View>
                  )}
                  {gameDayStep === "Check-in" && (
                    <Button
                      text={checkedIn ? "Undo check-in" : "I’m here"}
                      onPress={() => setCheckedIn(!checkedIn)}
                    />
                  )}
                </>
              )}
              {panel === "campuses" && (
                <>
                  <Text style={styles.sheetTitle}>Campuses</Text>
                  <Label style={styles.muted}>One campus at a time</Label>
                  <View style={styles.card}>
                    <Label style={styles.heading}>LUMS ✓</Label>
                    <Label style={styles.muted}>Your verified campus</Label>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.chalk },
  label: { color: colors.ink, fontSize: 14, fontWeight: "500" },
  muted: { color: colors.muted, lineHeight: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 10 },
  pill: {
    borderRadius: 11,
    backgroundColor: colors.chalk,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#E2E6DF",
    alignSelf: "flex-start",
  },
  pillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillText: { color: colors.muted, fontWeight: "700" },
  pillTextActive: { color: colors.chalk, fontWeight: "700" },
  button: {
    backgroundColor: colors.red,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    marginVertical: 4,
  },
  buttonLight: { backgroundColor: colors.chalk },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  buttonTextLight: { color: colors.ink },
  map: { flex: 1, backgroundColor: "#FFB976" },
  story: { paddingTop: 124, paddingHorizontal: 14, paddingBottom: 110 },
  hero: { height: 450 },
  heroKicker: { fontSize: 18, fontWeight: "800" },
  heroTitle: {
    fontFamily: "BigShoulders",
    fontSize: 167,
    fontWeight: "900",
    lineHeight: 180,
    marginTop: -14,
    marginLeft: -3,
  },
  heroDescription: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: -7,
  },
  condition: {
    backgroundColor: colors.chalk,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scrollHint: { color: "#765D41" },
  filter: {
    alignSelf: "flex-start",
    padding: 3,
    borderRadius: 13,
    backgroundColor: colors.chalk,
    marginBottom: 70,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 28,
  },
  chapter: { minHeight: 360, justifyContent: "center" },
  mapTop: {
    position: "absolute",
    top: 75,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  crumb: { backgroundColor: colors.chalk, borderRadius: 24, padding: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  rail: {
    position: "absolute",
    top: 154,
    right: 15,
    backgroundColor: colors.chalk,
    borderRadius: 17,
    padding: 5,
    alignItems: "center",
  },
  railButton: {
    fontSize: 24,
    width: 34,
    textAlign: "center",
    backgroundColor: "#E6E9E2",
    borderRadius: 10,
  },
  railDots: { color: colors.red, lineHeight: 17, textAlign: "center" },
  gameCard: {
    backgroundColor: colors.chalk,
    padding: 18,
    borderRadius: 22,
    marginBottom: 10,
    shadowColor: "#593B28",
    shadowOpacity: 0.22,
    shadowRadius: 15,
    elevation: 5,
  },
  eyebrow: {
    color: "#B85138",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  cardTitle: {
    fontFamily: "BigShoulders",
    color: colors.ink,
    fontSize: 43,
    fontWeight: "900",
    marginVertical: 8,
  },
  spots: {
    backgroundColor: "#DDEED1",
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  tabBar: {
    backgroundColor: colors.chalk,
    height: 91,
    paddingTop: 11,
    paddingBottom: 20,
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#DFE2DA",
  },
  tabButton: { flex: 1, alignItems: "center" },
  tabIcon: { fontSize: 28, color: "#91A098" },
  tabLabel: { fontSize: 11, fontWeight: "700", color: "#91A098" },
  activeTab: { color: colors.red },
  page: { flex: 1 },
  pageContent: {
    paddingHorizontal: 16,
    paddingTop: 72,
    paddingBottom: 50,
    gap: 14,
  },
  pageTitle: {
    fontFamily: "BigShoulders",
    fontWeight: "900",
    fontSize: 57,
    color: colors.ink,
  },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 17, gap: 10 },
  heading: { fontWeight: "800", fontSize: 16 },
  listTitle: { fontWeight: "800", fontSize: 20, marginTop: 15 },
  podium: {
    backgroundColor: "#1A2540",
    borderRadius: 24,
    height: 260,
    padding: 20,
    alignItems: "center",
    justifyContent: "space-between",
  },
  podiumTitle: {
    color: "#F5BE5E",
    fontFamily: "BigShoulders",
    fontSize: 36,
    fontWeight: "900",
  },
  podiumBars: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
  podiumBar: {
    width: 66,
    backgroundColor: "#C7794D",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  standing: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: "#DADFD5",
  },
  rule: { borderBottomWidth: 1, borderColor: "#ECEEE8", paddingVertical: 7 },
  playerCard: {
    height: 280,
    borderRadius: 21,
    backgroundColor: "#214C3C",
    padding: 19,
  },
  playerText: { color: "#F6EFDC", fontWeight: "700", fontSize: 13 },
  playerNumber: {
    fontFamily: "BigShoulders",
    fontWeight: "900",
    fontSize: 84,
    color: "#E9B567",
    lineHeight: 85,
  },
  playerName: {
    fontFamily: "BigShoulders",
    fontWeight: "800",
    fontSize: 35,
    color: "#fff",
  },
  setting: {
    minHeight: 58,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: "#fff",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modal: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,.45)" },
  sheet: {
    backgroundColor: colors.chalk,
    maxHeight: "88%",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
  },
  fullSheet: {
    height: "100%",
    maxHeight: "100%",
    borderRadius: 0,
    paddingTop: 32,
  },
  grab: { height: 28, alignItems: "center", justifyContent: "center" },
  handle: { width: 39, height: 4, borderRadius: 4, backgroundColor: "#BBC3BB" },
  sheetBody: { padding: 20, paddingBottom: 55, gap: 10 },
  sheetTitle: {
    fontFamily: "BigShoulders",
    fontSize: 54,
    fontWeight: "900",
    color: colors.ink,
  },
  spotBanner: {
    backgroundColor: "#D8EDC6",
    borderRadius: 18,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  spotNumber: {
    fontFamily: "BigShoulders",
    fontSize: 55,
    fontWeight: "900",
    color: colors.ink,
  },
  roster: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: 15,
  },
  rosterDot: {
    width: 31,
    height: 31,
    backgroundColor: "#346847",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { color: colors.muted, fontWeight: "800", marginTop: 13 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 15,
  },
  stepButton: { fontSize: 30, paddingHorizontal: 12 },
  stepNumber: {
    fontFamily: "BigShoulders",
    fontSize: 40,
    fontWeight: "900",
    textAlign: "center",
    color: colors.ink,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 13,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    marginVertical: 10,
  },
});
