import type { CodecType } from '@novasamatech/host-api';
import {
  Arrangement as ArrangementCodec,
  BlendingMode as BlendingModeCodec,
  BorderStyle as BorderStyleCodec,
  ButtonVariant as ButtonVariantCodec,
  ColorToken as ColorTokenCodec,
  ContentAlignment as ContentAlignmentCodec,
  Dimensions as DimensionsCodec,
  Effect as EffectCodec,
  HorizontalAlignment as HorizontalAlignmentCodec,
  ImageFit as ImageFitCodec,
  ImageSource as ImageSourceCodec,
  Modifier as ModifierCodec,
  Shape as ShapeCodec,
  Size as SizeCodec,
  TypographyStyle as TypographyStyleCodec,
  VerticalAlignment as VerticalAlignmentCodec,
} from '@novasamatech/host-api';

export type Modifier = CodecType<typeof ModifierCodec>;

export type ColorToken = CodecType<typeof ColorTokenCodec>;
export type TypographyStyle = CodecType<typeof TypographyStyleCodec>;
export type ButtonVariant = CodecType<typeof ButtonVariantCodec>;
export type ContentAlignment = CodecType<typeof ContentAlignmentCodec>;
export type HorizontalAlignment = CodecType<typeof HorizontalAlignmentCodec>;
export type VerticalAlignment = CodecType<typeof VerticalAlignmentCodec>;
export type Arrangement = CodecType<typeof ArrangementCodec>;
export type Shape = CodecType<typeof ShapeCodec>;
export type BorderStyle = CodecType<typeof BorderStyleCodec>;
export type BlendingMode = CodecType<typeof BlendingModeCodec>;
export type ImageSource = CodecType<typeof ImageSourceCodec>;
export type ImageFit = CodecType<typeof ImageFitCodec>;
export type Effect = CodecType<typeof EffectCodec>;

export type Size = CodecType<typeof SizeCodec>;
export type Dimensions = CodecType<typeof DimensionsCodec>;
export type Padding = Size | Dimensions;

export interface BackgroundStyle {
  color: ColorToken;
  shape?: Shape;
}

export type Background = ColorToken | BackgroundStyle;

export interface BaseWidgetProps {
  margin?: Padding;
  padding?: Padding;
  background?: Background;
  border?: BorderStyle;
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  fillMaxWidth?: boolean | number;
  fillMaxHeight?: boolean | number;
  /** 0 is transparent, 255 is opaque. */
  opacity?: number;
  /** How the node composites with what is behind it (CSS `mix-blend-mode` values). */
  blendingMode?: BlendingMode;
}

export interface BoxProps extends BaseWidgetProps {
  contentAlignment?: ContentAlignment;
}

export interface ColumnProps extends BaseWidgetProps {
  horizontalAlignment?: HorizontalAlignment;
  verticalArrangement?: Arrangement;
}

export interface RowProps extends BaseWidgetProps {
  verticalAlignment?: VerticalAlignment;
  horizontalArrangement?: Arrangement;
}

export type SpacerProps = BaseWidgetProps;

export interface TextProps extends BaseWidgetProps {
  style?: TypographyStyle;
  color?: ColorToken;
}

export interface ButtonProps extends BaseWidgetProps {
  text: string;
  variant?: ButtonVariant;
  enabled?: boolean;
  loading?: boolean;
  onClick(): void;
}

export interface ImageProps extends BaseWidgetProps {
  /** Where the host fetches the image from; the tree carries no URL. */
  source: ImageSource;
  /** Defaults to `fill`. */
  fit?: ImageFit;
}

/** Applies a visual effect to its children. Takes no layout modifiers. */
export interface EffectProps {
  effect: Effect;
}

export interface TextFieldProps extends BaseWidgetProps {
  value: string;
  placeholder?: string;
  label?: string;
  enabled?: boolean;
  onValueChange(value: string): void;
}
