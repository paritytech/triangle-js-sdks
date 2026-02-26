import { Enum, Status, lazy } from '@novasamatech/scale';
import type { Codec, CodecType } from 'scale-ts';
import { Option, Struct, Tuple, Vector, _void, bool, compact, str } from 'scale-ts';

export const Size = compact;
export const Dimensions = Tuple(Size, Size, Option(Size), Option(Size));

export const TypographyStyle = Status('titleXL', 'headline', 'bodyM', 'bodyS', 'caption');

export const ButtonVariant = Status('primary', 'secondary', 'text');

export const ColorToken = Status(
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'backgroundPrimary',
  'backgroundSecondary',
  'backgroundTertiary',
  'success',
  'error',
  'warning',
);

export const ContentAlignment = Status(
  'topStart',
  'topCenter',
  'topEnd',
  'centerStart',
  'center',
  'centerEnd',
  'bottomStart',
  'bottomCenter',
  'bottomEnd',
);

export const HorizontalAlignment = Status('start', 'center', 'end');

export const VerticalAlignment = Status('top', 'center', 'bottom');

export const Arrangement = Status('start', 'end', 'center', 'spaceBetween', 'spaceAround', 'spaceEvenly');

export const Shape = Enum({
  Rounded: Size,
  Circle: _void,
});

export const BorderStyle = Struct({
  width: Size,
  color: ColorToken,
  shape: Option(Shape),
});

export const Modifiers = Struct({
  margin: Option(Dimensions),
  padding: Option(Dimensions),
  background: Option(
    Struct({
      color: ColorToken,
      shape: Option(Shape),
    }),
  ),
  border: Option(BorderStyle),
  height: Option(Size),
  width: Option(Size),
  minWidth: Option(Size),
  minHeight: Option(Size),
  fillWidth: Option(bool),
  fillHeight: Option(bool),
});

type EnumVariants<T> = { [K in keyof T]: { tag: K; value: T[K] } }[keyof T];

const Children = lazy(() => CustomRendererNode);

type ComponentType<Props extends Codec<any>> = CodecType<ReturnType<typeof Component<Props>>>;
function Component<Props extends Codec<any>>(props: Props) {
  return Struct({
    modifiers: Option(Modifiers),
    props: props,
    children: Vector(Children),
  });
}

export const BoxProps = Struct({
  contentAlignment: Option(ContentAlignment),
});

export const ColumnProps = Struct({
  horizontalAlignment: Option(HorizontalAlignment),
  verticalArrangement: Option(Arrangement),
});

export const RowProps = Struct({
  verticalAlignment: Option(VerticalAlignment),
  horizontalArrangement: Option(Arrangement),
});

export const TextProps = Struct({
  style: Option(TypographyStyle),
  color: Option(ColorToken),
});

export const ButtonProps = Struct({
  variant: Option(ButtonVariant),
  enabled: Option(bool),
  loading: Option(bool),
  clickAction: Option(str),
});

export const TextFieldProps = Struct({
  value: Option(str),
  placeholder: Option(str),
  label: Option(str),
  enabled: Option(bool),
  valueChangeAction: Option(str),
});

export type CustomRendererNodeType = EnumVariants<{
  Nil: undefined;
  String: string;
  Box: ComponentType<typeof BoxProps>;
  Column: ComponentType<typeof ColumnProps>;
  Row: ComponentType<typeof RowProps>;
  Spacer: ComponentType<typeof _void>;
  Text: ComponentType<typeof TextProps>;
  Button: ComponentType<typeof ButtonProps>;
  TextField: ComponentType<typeof TextFieldProps>;
}>;

export const CustomRendererNode: Codec<CustomRendererNodeType> = Enum({
  Nil: _void,
  String: str,
  Box: Component(BoxProps),
  Column: Component(ColumnProps),
  Row: Component(RowProps),
  Spacer: Component(_void),
  Text: Component(TextProps),
  Button: Component(ButtonProps),
  TextField: Component(TextFieldProps),
});
