import * as React from "react";
import type { InputDatum } from "victory-native-skia";
import { transformInputData } from "../utils/transformInputData";
import { type LayoutChangeEvent } from "react-native";
import { Canvas, Line, vec } from "@shopify/react-native-skia";
import { type CurveType, makeLinePath } from "./makeLinePath";
import {
  makeMutable,
  runOnJS,
  type SharedValue,
  useSharedValue,
} from "react-native-reanimated";
import type { SidedNumber, TransformedData } from "../types";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { findClosestPoint } from "../utils/findClosestPoint";
import { valueFromSidedNumber } from "../utils/valueFromSidedNumber";

type LineChartProps<
  T extends InputDatum,
  XK extends keyof T,
  YK extends keyof T,
> = {
  data: T[];
  xKey: XK;
  yKeys: YK[];
  curve?: CurveType;
  // TODO: xScale, yScale
  // TODO: Axes
  padding?: SidedNumber;
  domainPadding?: SidedNumber;
  onPressActiveChange?: (isPressActive: boolean) => void;
  activePressX?: {
    value?: SharedValue<T[XK]>;
    position?: SharedValue<number>;
  };
  activePressY?: {
    [K in YK]?: { value?: SharedValue<T[K]>; position?: SharedValue<number> };
  };
  children: (args: {
    paths: { [K in YK]: string };
    isPressActive: boolean;
    activePressX: { value: SharedValue<T[XK]>; position: SharedValue<number> };
    activePressY: {
      [K in YK]: { value: SharedValue<T[K]>; position: SharedValue<number> };
    };
  }) => React.ReactNode;
};

export function LineChart<
  T extends InputDatum,
  XK extends keyof T,
  YK extends keyof T,
>({
  data,
  xKey,
  yKeys,
  curve = "linear",
  padding,
  domainPadding,
  onPressActiveChange,
  activePressX: incomingActivePressX,
  activePressY: incomingActivePressY,
  children,
}: LineChartProps<T, XK, YK>) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const onLayout = React.useCallback(
    ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
      setSize(layout);
    },
    [],
  );

  const tData = useSharedValue<TransformedData<T, XK, YK>>({
    ix: [],
    ox: [],
    y: yKeys.reduce(
      (acc, key) => {
        acc[key] = { i: [], o: [] };
        return acc;
      },
      {} as TransformedData<T, XK, YK>["y"],
    ),
  });
  const { paths, xScale, yScale } = React.useMemo(() => {
    const { xScale, yScale, ..._tData } = transformInputData({
      data,
      xKey,
      yKeys,
      // TODO: These are likely going to need to change.
      // TODO: domainPadding needs to get applied at the scale level i think?
      outputWindow: {
        xMin:
          valueFromSidedNumber(padding, "left") +
          valueFromSidedNumber(domainPadding, "left"),
        xMax:
          size.width -
          (valueFromSidedNumber(padding, "right") +
            valueFromSidedNumber(domainPadding, "right")),
        yMin:
          valueFromSidedNumber(padding, "top") +
          valueFromSidedNumber(domainPadding, "top"),
        yMax:
          size.height -
          (valueFromSidedNumber(padding, "bottom") +
            valueFromSidedNumber(domainPadding, "bottom")),
      },
    });
    tData.value = _tData;

    const paths = yKeys.reduce(
      (acc, key) => {
        acc[key] = makeLinePath(curve, _tData.ox, _tData.y[key].o);
        return acc;
      },
      {} as { [K in YK]: string },
    );

    return { tData, paths, xScale, yScale };
  }, [data, xKey, yKeys, size, curve]);

  const [isPressActive, setIsPressActive] = React.useState(false);
  const changePressActive = React.useCallback(
    (val: boolean) => {
      setIsPressActive(val);
      onPressActiveChange?.(val);
    },
    [onPressActiveChange],
  );
  const internalActivePressX = React.useRef({
    value: makeMutable(0 as T[XK]),
    position: makeMutable(0),
  });
  const activePressX = {
    value: incomingActivePressX?.value || internalActivePressX.current.value,
    position:
      incomingActivePressX?.position || internalActivePressX.current.position,
  };

  const internalActivePressY = React.useRef(
    yKeys.reduce(
      (acc, key) => {
        acc[key] = {
          value: makeMutable(0 as T[YK]),
          position: makeMutable(0),
        };
        return acc;
      },
      {} as Parameters<
        LineChartProps<T, XK, YK>["children"]
      >[0]["activePressY"],
    ),
  );
  const activePressY = yKeys.reduce(
    (acc, key) => {
      acc[key] = {
        value:
          incomingActivePressY?.[key]?.value ||
          internalActivePressY.current[key].value,
        position:
          incomingActivePressY?.[key]?.position ||
          internalActivePressY.current[key].position,
      };
      return acc;
    },
    {} as Parameters<LineChartProps<T, XK, YK>["children"]>[0]["activePressY"],
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      runOnJS(changePressActive)(true);
    })
    .onUpdate((evt) => {
      const idx = findClosestPoint(tData.value.ox, evt.x);
      if (typeof idx !== "number") return;

      // TODO: Types, add safety checks
      activePressX.value.value = tData.value.ix[idx] as T[XK];
      activePressX.position.value = tData.value.ox[idx]!;

      yKeys.forEach((key) => {
        activePressY[key].value.value = tData.value.y[key].i[idx] as T[YK];
        activePressY[key].position.value = tData.value.y[key].o[idx]!;
      });
    })
    .onEnd(() => {
      runOnJS(changePressActive)(false);
    });

  const [x1, x2] = xScale.domain();
  const [y1, y2] = yScale.domain();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={pan}>
        <Canvas style={{ flex: 1 }} onLayout={onLayout}>
          {children({
            paths,
            isPressActive: isPressActive,
            activePressX: activePressX,
            activePressY: activePressY,
          })}
          {/* Throw in some dummy axes */}
          <Line
            p1={vec(xScale(x1!), yScale(y1!))}
            p2={vec(xScale(x1!), yScale(y2!))}
          />
          <Line
            p1={vec(xScale(x1!), yScale(y2!))}
            p2={vec(xScale(x2!), yScale(y2!))}
          />
        </Canvas>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}