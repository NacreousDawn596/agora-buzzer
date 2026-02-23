import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './screens/HomeScreen';
import BuzzerScreen from './screens/BuzzerScreen';

export type RootStackParamList = {
  Home: undefined;
  Buzzer: {
    teamId:      string;
    teamName:    string;
    sessionId:   string;
    wsToken:     string;
    accessToken: string;
    slot:        'team_a' | 'team_b';   // ← which side this player owns, set at join time
    opponent:    { id: string; name: string; score: number } | null;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: '#F2E8D5' },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Buzzer" component={BuzzerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}