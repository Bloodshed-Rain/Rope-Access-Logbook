import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, View, Text, Pressable } from 'react-native';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

export type ToastVariant = 'ok' | 'warn' | 'err' | 'info';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ActiveToast extends Required<ToastOptions> {
  id: number;
}

interface ToastContextValue {
  show: (opts: ToastOptions | string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 2500;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (__DEV__) {
      throw new Error('useToast() called outside <ToastProvider>. Mount ToastProvider in App.tsx.');
    }
    return { show: () => {} };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const counter = useRef(0);

  const show = useCallback((opts: ToastOptions | string) => {
    const normalized: ToastOptions =
      typeof opts === 'string' ? { message: opts } : opts;
    counter.current += 1;
    setToast({
      id: counter.current,
      message: normalized.message,
      variant: normalized.variant ?? 'ok',
      durationMs: normalized.durationMs ?? DEFAULT_DURATION_MS,
    });
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <ToastView
          key={toast.id}
          toast={toast}
          onDismiss={() => setToast((t) => (t?.id === toast.id ? null : t))}
        />
      )}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ActiveToast; onDismiss: () => void }) {
  const { colors, spacing, typography } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 160,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 16,
          duration: 160,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDismiss();
      });
    }, toast.durationMs);

    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, opacity, translateY, onDismiss]);

  const accent =
    toast.variant === 'ok'
      ? colors.statusOk
      : toast.variant === 'warn'
      ? colors.statusWarn
      : toast.variant === 'err'
      ? colors.statusErr
      : colors.textSecondary;

  const Icon =
    toast.variant === 'ok'
      ? CheckCircle2
      : toast.variant === 'warn'
      ? AlertTriangle
      : toast.variant === 'err'
      ? XCircle
      : Info;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: spacing.xxl,
        alignItems: 'center',
        opacity,
        transform: [{ translateY }],
      }}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.base,
          backgroundColor: colors.bgSurface,
          borderWidth: 1,
          borderColor: colors.border,
          maxWidth: '90%',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: accent,
          }}
        />
        <Icon color={accent} size={18} />
        <Text
          style={[
            typography.label,
            { color: colors.textPrimary, flexShrink: 1 },
          ]}
          numberOfLines={2}
        >
          {toast.message}
        </Text>
        <X color={colors.textDisabled} size={14} />
      </Pressable>
    </Animated.View>
  );
}
