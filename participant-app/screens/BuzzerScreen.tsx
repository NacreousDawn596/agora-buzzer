import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  Animated, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

const { width, height } = Dimensions.get('window');
const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'wss://agora-buzzer.fly.dev/'; 

type BuzzerState = 'disabled' | 'enabled' | 'locked';

interface TeamData {
  id: string;
  name: string;
  score: number;
  is_connected: boolean;
}

type Props = NativeStackScreenProps<RootStackParamList, 'Buzzer'>;

export default function BuzzerScreen({ route, navigation }: Props) {
  const { teamId, teamName, sessionId, wsToken, opponent: initOpponent } = route.params;

  // State
  const [buzzerState, setBuzzerState] = useState<BuzzerState>('disabled');
  const [myData, setMyData] = useState<TeamData>({ id: teamId, name: teamName, score: 0, is_connected: true });
  const [oppData, setOppData] = useState<TeamData | null>(initOpponent ? { ...initOpponent, is_connected: false } : null);
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const [questionNum, setQuestionNum] = useState(0);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [iDidBuzz, setIDidBuzz] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animations
  const buzzerScale = useRef(new Animated.Value(1)).current;
  const buzzerOpacity = useRef(new Animated.Value(1)).current;
  const winnerAnim = useRef(new Animated.Value(0)).current;
  const enabledPulse = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(1)).current;
  const oppScoreAnim = useRef(new Animated.Value(1)).current;

  // ── WS ──────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_URL}ws/session/${sessionId}?token=${wsToken}`);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => {
      setWsStatus('connected');
      pingTimer.current = setInterval(() => {
        ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = e => {
      try { handleMsg(JSON.parse(e.data)); } catch { /* */ }
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      clearInterval(pingTimer.current!);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [sessionId, wsToken]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current!);
      clearInterval(pingTimer.current!);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Message handler ──────────────────────────────────────────────────────
  const handleMsg = (msg: any) => {
    // Sync teams from every message that carries team_a/team_b
    if (msg.team_a && msg.team_b) {
      const mySlot = msg.team_a.id === teamId ? 'team_a' : msg.team_b.id === teamId ? 'team_b' : null;
      const oppSlot = mySlot === 'team_a' ? 'team_b' : mySlot === 'team_b' ? 'team_a' : null;
      if (mySlot) { const d = msg[mySlot]; setMyData(prev => ({ ...prev, ...d })); }
      if (oppSlot) { const d = msg[oppSlot]; setOppData(prev => ({ ...(prev ?? {}), ...d } as TeamData)); }
    }

    switch (msg.type) {
      case 'connected':
      case 'state_sync':
        setBuzzerState(msg.buzzer_state);
        setQuestionNum(msg.question_number ?? 0);
        if (msg.buzzer_winner) setWinner({ id: msg.buzzer_winner, name: msg.buzzer_winner_name ?? msg.buzzer_winner });
        else setWinner(null);
        break;

      case 'buzzer_locked':
        setBuzzerState('locked');
        setWinner({ id: msg.winner_id, name: msg.winner_name });
        if (msg.winner_id === teamId) triggerWinAnim();
        else triggerLossAnim();
        break;

      case 'opponent_connected':
      case 'opponent_disconnected':
        // team data already synced above
        break;
    }
  };

  // ── Animations ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (buzzerState === 'enabled') {
      setIDidBuzz(false);
      setWinner(null);
      Animated.loop(
        Animated.sequence([
          Animated.timing(enabledPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(enabledPulse, { toValue: 0, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      enabledPulse.stopAnimation();
      enabledPulse.setValue(0);
    }
  }, [buzzerState]);

  useEffect(() => {
    if (buzzerState === 'locked') {
      Animated.spring(winnerAnim, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }).start();
    } else {
      winnerAnim.setValue(0);
    }
  }, [buzzerState, winner]);

  const triggerWinAnim = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.spring(buzzerScale, { toValue: 1.12, useNativeDriver: true }),
      Animated.spring(buzzerScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
  };

  const triggerLossAnim = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.sequence([
      Animated.timing(buzzerOpacity, { toValue: 0.35, duration: 80, useNativeDriver: true }),
      Animated.timing(buzzerOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  // ── BUZZ ─────────────────────────────────────────────────────────────────
  const handleBuzz = () => {
    if (buzzerState !== 'enabled' || iDidBuzz) return;
    setIDidBuzz(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Animated.sequence([
      Animated.spring(buzzerScale, { toValue: 0.91, useNativeDriver: true }),
      Animated.spring(buzzerScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    wsRef.current?.send(JSON.stringify({ type: 'buzz', team_id: teamId }));
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const isWinner = winner?.id === teamId;
  const isLocked = buzzerState === 'locked';
  const iAmLoser = isLocked && !isWinner;

  const buzzerBg: [string, string] = buzzerState === 'enabled'
    ? ['#D0EDD1', '#BDE5BF']
    : isWinner ? ['#F0E8C8', '#E8DCA8']
      : iAmLoser ? ['#F0E8E8', '#E8D8D8']
        : ['#EDE0C8', '#E3D4B8'];

  const buzzerBorder = buzzerState === 'enabled' ? '#2A6B2E'
    : isWinner ? '#9A7410'
      : iAmLoser ? '#9B2D22'
        : '#B09070';

  const buzzerLabel = buzzerState === 'disabled' ? 'STAND BY'
    : buzzerState === 'enabled' ? 'BUZZ!'
      : isWinner ? 'YOU WON!' : 'TOO SLOW';

  const enabledScale = enabledPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const wsColor = wsStatus === 'connected' ? '#2A6B2E' : wsStatus === 'connecting' ? '#C4621A' : '#9B2D22';

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F9F2E7', '#F2E8D5', '#EDE0C8']} style={StyleSheet.absoluteFillObject} />

      {/* Winner glow overlay */}
      {isWinner && (
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(154,116,16,0.06)', opacity: winnerAnim }]} />
      )}

      <SafeAreaView style={styles.safe}>

        {/* ── TOP: VS Score Bar ── */}
        <View style={styles.scoreBar}>
          {/* My side */}
          <View style={[styles.scoreHalf, styles.scoreHalfLeft]}>
            <View style={styles.scoreTeamInfo}>
              <View style={[styles.connDot, { backgroundColor: myData.is_connected ? '#2A6B2E' : '#D4C4A8' }]} />
              <Text style={styles.scoreTeamName} numberOfLines={1}>{myData.name}</Text>
            </View>
            <Animated.Text style={[
              styles.scoreBig, styles.scoreMe,
              isWinner && styles.scoreWinner,
              iAmLoser && styles.scoreLoser,
            ]}>
              {myData.score}
            </Animated.Text>
          </View>

          {/* VS divider */}
          <View style={styles.vsDivider}>
            <Text style={[
              styles.vsText,
              buzzerState === 'enabled' && styles.vsEnabled,
              isLocked && (isWinner ? styles.vsWon : styles.vsLost),
            ]}>
              {questionNum > 0 ? `Q${questionNum}` : 'VS'}
            </Text>
          </View>

          {/* Opponent side */}
          <View style={[styles.scoreHalf, styles.scoreHalfRight]}>
            <Animated.Text style={[
              styles.scoreBig, styles.scoreOpp,
              !isWinner && isLocked && styles.scoreWinner,
              isWinner && isLocked && styles.scoreLoser,
            ]}>
              {oppData?.score ?? 0}
            </Animated.Text>
            <View style={[styles.scoreTeamInfo, styles.scoreTeamInfoRight]}>
              <Text style={[styles.scoreTeamName, styles.scoreTeamNameRight]} numberOfLines={1}>
                {oppData?.name ?? '—'}
              </Text>
              <View style={[styles.connDot, { backgroundColor: oppData?.is_connected ? '#2A6B2E' : '#D4C4A8' }]} />
            </View>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.scoreDivider} />

        {/* ── BUZZER ── */}
        <View style={styles.buzzerArea}>

          {/* Enabled glow halo */}
          {buzzerState === 'enabled' && (
            <Animated.View style={[styles.glowHalo, { opacity: enabledPulse, transform: [{ scale: enabledScale }] }]} />
          )}

          <Animated.View style={[styles.buzzerOuter, { borderColor: buzzerBorder, transform: [{ scale: buzzerScale }], opacity: buzzerOpacity }]}>
            <TouchableOpacity
              onPress={handleBuzz}
              disabled={buzzerState !== 'enabled' || iDidBuzz}
              activeOpacity={0.82}
              style={styles.buzzerTouchable}
            >
              <LinearGradient colors={buzzerBg} style={styles.buzzerInner}>
                <View style={styles.buzzerRing} />

                <Text style={[
                  styles.buzzerLabel,
                  buzzerState === 'enabled' && styles.buzzerLabelEnabled,
                  isWinner && styles.buzzerLabelWin,
                  iAmLoser && styles.buzzerLabelLoss,
                ]}>
                  {buzzerLabel}
                </Text>

                {buzzerState === 'enabled' && !iDidBuzz && (
                  <Text style={styles.buzzerSub}>TAP NOW</Text>
                )}
                {iDidBuzz && buzzerState === 'enabled' && (
                  <Text style={styles.buzzerSub}>WAITING...</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* State text */}
          <Text style={styles.stateText}>
            {buzzerState === 'disabled' && 'Waiting for question...'}
            {buzzerState === 'enabled' && 'Question is live — buzz in!'}
            {isWinner && 'Answer the question!'}
            {iAmLoser && `${winner?.name ?? 'Opponent'} buzzed first`}
          </Text>
        </View>

        {/* ── WINNER BANNER ── */}
        {isLocked && winner && (
          <Animated.View style={[
            styles.winnerBanner,
            { borderColor: isWinner ? '#9A7410' : '#D4C4A8' },
            { opacity: winnerAnim, transform: [{ translateY: winnerAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
          ]}>
            <Text style={styles.winnerBannerLabel}>
              {isWinner ? '⚡ YOU BUZZED FIRST' : '🔔 FIRST TO BUZZ'}
            </Text>
            <Text style={[styles.winnerBannerName, isWinner && { color: '#9A7410' }]}>
              {winner.name.toUpperCase()}
            </Text>
          </Animated.View>
        )}

        {/* ── STATUS BAR ── */}
        <View style={styles.statusBar}>
          <View style={[styles.wsDot, { backgroundColor: wsColor }]} />
          <Text style={styles.statusText}>
            {wsStatus === 'connected' ? 'CONNECTED' : wsStatus === 'connecting' ? 'CONNECTING...' : 'RECONNECTING...'}
          </Text>
        </View>

      </SafeAreaView>
    </View>
  );
}

const BUZZER_SIZE = Math.min(width * 0.68, 288);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2E8D5' },
  safe: { flex: 1 },

  // ── Score bar ──
  scoreBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: 8,
    minHeight: 100,
  },
  scoreHalf: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  scoreHalfLeft: { alignItems: 'flex-start', borderRightWidth: 0 },
  scoreHalfRight: { alignItems: 'flex-end' },
  scoreTeamInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  scoreTeamInfoRight: { flexDirection: 'row-reverse' },
  connDot: { width: 6, height: 6, borderRadius: 3 },
  scoreTeamName: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 10, color: '#8C6840', letterSpacing: 2, textTransform: 'uppercase',
    maxWidth: width * 0.3,
  },
  scoreTeamNameRight: { textAlign: 'right' },
  scoreBig: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 52, lineHeight: 56, color: '#7A5C3A',
  },
  scoreMe: { color: '#2C1A0E' },
  scoreOpp: { color: '#7A5C3A' },
  scoreWinner: { color: '#9A7410' },
  scoreLoser: { color: '#C8B090' },

  vsDivider: {
    width: 56, alignItems: 'center', justifyContent: 'center',
    borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#D4C4A8',
  },
  vsText: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 14, color: '#B09070', fontStyle: 'italic', letterSpacing: 2,
  },
  vsEnabled: { color: '#2A6B2E' },
  vsWon: { color: '#9A7410' },
  vsLost: { color: '#9B2D22' },

  scoreDivider: { height: 1, backgroundColor: '#D4C4A8', marginHorizontal: 0 },

  // ── Buzzer ──
  buzzerArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },

  glowHalo: {
    position: 'absolute',
    width: BUZZER_SIZE + 70, height: BUZZER_SIZE + 70,
    borderRadius: (BUZZER_SIZE + 70) / 2,
    backgroundColor: 'rgba(42,107,46,0.12)',
  },

  buzzerOuter: {
    width: BUZZER_SIZE, height: BUZZER_SIZE, borderRadius: BUZZER_SIZE / 2,
    borderWidth: 2, overflow: 'hidden',
    shadowColor: '#2C1A0E', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 8,
  },
  buzzerTouchable: { flex: 1 },
  buzzerInner: {
    flex: 1, borderRadius: BUZZER_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  buzzerRing: {
    position: 'absolute',
    width: BUZZER_SIZE * 0.84, height: BUZZER_SIZE * 0.84,
    borderRadius: (BUZZER_SIZE * 0.84) / 2,
    borderWidth: 1, borderColor: 'rgba(44,26,14,0.07)',
  },

  buzzerLabel: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 20, color: '#A08060', letterSpacing: 5, textTransform: 'uppercase',
  },
  buzzerLabelEnabled: { color: '#1A5E1E', fontSize: 32, letterSpacing: 6 },
  buzzerLabelWin: { color: '#8A6408', fontSize: 22 },
  buzzerLabelLoss: { color: '#8C2A20', fontSize: 18 },

  buzzerSub: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 10, color: '#3A8C3F', letterSpacing: 5,
    marginTop: 10, opacity: 0.8,
  },

  stateText: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 12, color: '#A08060', fontStyle: 'italic',
    letterSpacing: 1, marginTop: 20, textAlign: 'center',
  },

  // ── Winner banner ──
  winnerBanner: {
    marginHorizontal: 28,
    borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  winnerBannerLabel: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 9, color: '#8C6840', letterSpacing: 4, textTransform: 'uppercase',
  },
  winnerBannerName: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 18, color: '#2C1A0E', letterSpacing: 3, marginTop: 4,
  },

  // ── Status ──
  statusBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 6,
    borderTopWidth: 1, borderTopColor: '#D4C4A8',
  },
  wsDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 9, color: '#B09070', letterSpacing: 3,
  },
});