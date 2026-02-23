import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Dimensions, Animated, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';

const { width, height } = Dimensions.get('window');
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const [teamId, setTeamId]   = useState('');
  const [loading, setLoading] = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(32)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const swordL    = useRef(new Animated.Value(-20)).current;
  const swordR    = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 900,  useNativeDriver: true }),
      ]),
    ]).start();

    // Swords converge animation
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(swordL, { toValue: -4,  duration: 2000, useNativeDriver: true }),
          Animated.timing(swordR, { toValue:  4,  duration: 2000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(swordL, { toValue: -20, duration: 2000, useNativeDriver: true }),
          Animated.timing(swordR, { toValue:  20, duration: 2000, useNativeDriver: true }),
        ]),
      ])
    ).start();

    // Button pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,     duration: 1100, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleJoin = async () => {
    const id = teamId.trim().toLowerCase();
    if (!id) {
      Alert.alert('Enter your Team ID', 'Type your team identifier to enter the arena.');
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert('Access Denied', data.detail ?? 'Team ID not recognized for this duel.');
        return;
      }
      navigation.replace('Buzzer', {
        teamId:      data.team_id,
        teamName:    data.team_name,
        sessionId:   data.session_id,
        wsToken:     data.ws_token,
        accessToken: data.access_token,
        // Lock in which side (A or B) this player owns — used forever after
        // so name/ID changes from admin still reach the right slot
        slot:        data.team_a?.id === data.team_id ? 'team_a' : 'team_b',
        opponent:    data.opponent ?? null,
      });
    } catch {
      Alert.alert('Connection Error', 'Cannot reach the server. Check your network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F9F2E7', '#F2E8D5', '#EDE0C8']} style={StyleSheet.absoluteFillObject} />

      {/* Top & bottom border lines */}
      <View style={styles.borderTop} />
      <View style={styles.borderBottom} />

      {/* Subtle warm glow behind center */}
      <View style={styles.centerGlow} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Brand */}
            <Text style={styles.brand}>AGORA</Text>
            <View style={styles.brandDivider} />

            {/* Duel indicator with animated swords */}
            <View style={styles.duelRow}>
              <Animated.Text style={[styles.sword, { transform: [{ translateX: swordL }] }]}>⚔</Animated.Text>
              <Text style={styles.duelLabel}>1  VS  1  DUEL</Text>
              <Animated.Text style={[styles.sword, styles.swordRight, { transform: [{ translateX: swordR }] }]}>⚔</Animated.Text>
            </View>

            <Text style={styles.tagline}>Enter the arena. Only one prevails.</Text>

            {/* Ornament */}
            <View style={styles.ornament}>
              <View style={styles.ornLine} />
              <View style={styles.ornGem} />
              <View style={styles.ornLine} />
            </View>

            {/* Input */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>YOUR TEAM ID</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. gadzit"
                  placeholderTextColor="#C8B090"
                  value={teamId}
                  onChangeText={setTeamId}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={handleJoin}
                  editable={!loading}
                />
              </View>
            </View>

            {/* CTA button */}
            <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%', maxWidth: 300 }}>
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleJoin}
                disabled={loading}
                activeOpacity={0.78}
              >
                {loading
                  ? <ActivityIndicator color="#7A5C3A" size="small" />
                  : <>
                      <Text style={styles.buttonText}>ENTER THE ARENA</Text>
                      <View style={styles.buttonAccentLine} />
                    </>
                }
              </TouchableOpacity>
            </Animated.View>

            {/* Bottom ornament */}
            <View style={[styles.ornament, { marginTop: 40 }]}>
              <View style={styles.ornLine} />
              <View style={styles.ornGem} />
              <View style={styles.ornLine} />
            </View>
            <Text style={styles.footer}>AGORA SYSTEMS · 1V1 EDITION</Text>

          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F2E8D5' },
  safe:         { flex: 1 },
  kav:          { flex: 1, justifyContent: 'center' },
  content:      { alignItems: 'center', paddingHorizontal: 32 },

  borderTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#7A5C3A', opacity: 0.5 },
  borderBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: '#7A5C3A', opacity: 0.5 },

  centerGlow: {
    position: 'absolute', top: height * 0.2, alignSelf: 'center',
    width: 340, height: 340, borderRadius: 170,
    backgroundColor: '#9B2D22', opacity: 0.04,
  },

  brand: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: Math.min(76, width * 0.19),
    fontWeight: '700',
    color: '#2C1A0E',
    letterSpacing: 18,
    textAlign: 'center',
  },
  brandDivider: {
    width: 50, height: 2, backgroundColor: '#9B2D22',
    marginTop: 12, marginBottom: 24, opacity: 0.7,
  },

  duelRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  sword:     { fontSize: 18, color: '#7A5C3A', opacity: 0.8 },
  swordRight:{ transform: [{ scaleX: -1 }] },
  duelLabel: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 13, color: '#7A5C3A', letterSpacing: 6, textTransform: 'uppercase',
  },

  tagline: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 13, color: '#8C6840', fontStyle: 'italic',
    marginBottom: 32, textAlign: 'center',
  },

  ornament: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 300, marginBottom: 28 },
  ornLine:  { flex: 1, height: 1, backgroundColor: '#D4C4A8' },
  ornGem:   { width: 6, height: 6, backgroundColor: '#7A5C3A', transform: [{ rotate: '45deg' }], marginHorizontal: 12 },

  inputSection: { width: '100%', maxWidth: 300, marginBottom: 20 },
  inputLabel:   {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 10, color: '#7A5C3A', letterSpacing: 4,
    textTransform: 'uppercase', marginBottom: 10,
  },
  inputWrapper: {
    borderWidth: 1, borderColor: '#B09070', borderBottomColor: '#7A5C3A',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  input: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 18, color: '#2C1A0E', paddingHorizontal: 18, paddingVertical: 14, letterSpacing: 3,
  },

  button: {
    borderWidth: 1.5, borderColor: '#2C1A0E',
    paddingVertical: 16, alignItems: 'center',
    backgroundColor: 'rgba(44,26,14,0.04)',
    position: 'relative', overflow: 'hidden',
  },
  buttonDisabled:    { opacity: 0.4 },
  buttonText: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 13, color: '#2C1A0E', letterSpacing: 5, textTransform: 'uppercase',
  },
  buttonAccentLine: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 2, backgroundColor: '#9B2D22',
  },

  footer: {
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
    fontSize: 9, color: '#C8B090', letterSpacing: 4,
    textTransform: 'uppercase', marginTop: 10,
  },
});