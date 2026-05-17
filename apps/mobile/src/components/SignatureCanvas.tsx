import React, { useState, useCallback, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/colors';

interface Point {
  x: number;
  y: number;
}

interface SignatureCanvasProps {
  onSignatureChange: (base64: string | null) => void;
}

/**
 * A reusable signature drawing component using react-native-svg.
 * Tracks touch events via GestureResponderEvent and exports the
 * drawn signature as a base64-encoded SVG string.
 */
export default function SignatureCanvas({ onSignatureChange }: SignatureCanvasProps) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [size, setSize] = useState({ width: 300, height: 200 });
  const isDrawing = useRef(false);

  const buildSvgString = useCallback((strokeData: Point[][], w: number, h: number): string => {
    const paths = strokeData
      .map((stroke) => {
        if (stroke.length < 2) return '';
        let d = `M ${stroke[0].x} ${stroke[0].y}`;
        for (let i = 1; i < stroke.length; i++) {
          d += ` L ${stroke[i].x} ${stroke[i].y}`;
        }
        return `<path d="${d}" stroke="black" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      })
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/>${paths}</svg>`;
  }, []);

  const encodeBase64 = useCallback((str: string): string => {
    try {
      return btoa(str);
    } catch {
      // Pure-JS fallback for environments without btoa
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let output = '';
      let i = 0;
      while (i < str.length) {
        const a = str.charCodeAt(i++);
        const b = i < str.length ? str.charCodeAt(i++) : 0;
        const c = i < str.length ? str.charCodeAt(i++) : 0;
        const bitmap = (a << 16) | (b << 8) | c;
        output += chars.charAt((bitmap >> 18) & 63);
        output += chars.charAt((bitmap >> 12) & 63);
        output += chars.charAt((bitmap >> 6) & 63);
        output += chars.charAt(bitmap & 63);
      }
      const rem = str.length % 3;
      if (rem) output = output.slice(0, rem - 3) + '==='.slice(rem);
      return output;
    }
  }, []);

  const emitChange = useCallback(
    (currentStrokes: Point[][]) => {
      const hasContent = currentStrokes.some((s) => s.length >= 2);
      if (!hasContent) {
        onSignatureChange(null);
        return;
      }
      const svg = buildSvgString(currentStrokes, size.width, size.height);
      const base64 = encodeBase64(svg);
      onSignatureChange(base64);
    },
    [buildSvgString, encodeBase64, onSignatureChange, size]
  );

  const handleGrant = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    isDrawing.current = true;
    setStrokes((prev) => [...prev, [{ x: locationX, y: locationY }]]);
  }, []);

  const handleMove = useCallback((e: GestureResponderEvent) => {
    if (!isDrawing.current) return;
    const { locationX, locationY } = e.nativeEvent;
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = [...next[next.length - 1], { x: locationX, y: locationY }];
      return next;
    });
  }, []);

  const handleRelease = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    setStrokes((prev) => {
      emitChange(prev);
      return prev;
    });
  }, [emitChange]);

  const handleClear = useCallback(() => {
    isDrawing.current = false;
    setStrokes([]);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const onLayout = useCallback((event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  return (
    <View style={styles.container}>
      <View
        style={styles.canvas}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleRelease}
      >
        <Svg width={size.width} height={size.height}>
          {strokes.map((stroke, index) => {
            if (stroke.length < 2) return null;
            let d = `M ${stroke[0].x} ${stroke[0].y}`;
            for (let i = 1; i < stroke.length; i++) {
              d += ` L ${stroke[i].x} ${stroke[i].y}`;
            }
            return (
              <Path
                key={index}
                d={d}
                stroke="black"
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </Svg>
      </View>
      <TouchableOpacity style={styles.clearButton} onPress={handleClear} activeOpacity={0.7}>
        <Text style={styles.clearButtonText}>Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  canvas: {
    height: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  clearButton: {
    alignSelf: 'flex-end',
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clearButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.fontWeight.medium as any,
  },
});
