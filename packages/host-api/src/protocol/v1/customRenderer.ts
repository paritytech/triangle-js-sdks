import { Enum, OptionBool, Status, lazy } from '@novasamatech/scale';
import type { Codec, CodecType } from 'scale-ts';
import { Option, Struct, Tuple, Vector, _void, bool, compact, str } from 'scale-ts';

export const Size = compact;
export const Dimensions = Tuple(Size, Size, Option(Size), Option(Size));

export const TypographyStyle = Status(
  'headline.large',
  'title.medium.regular',
  'body.large.regular',
  'body.medium.regular',
  'body.small.regular',
);

export const ButtonVariant = Status('primary', 'secondary', 'text');

export const ColorToken = Status(
  'fg.primary',
  'fg.secondary',
  'fg.tertiary',
  'bg.surface.main',
  'bg.surface.container',
  'bg.surface.nested',
  'fg.success',
  'fg.error',
  'fg.warning',
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

export const Modifier = Enum({
  margin: Dimensions,
  padding: Dimensions,
  background: Struct({
    color: ColorToken,
    shape: Option(Shape),
  }),
  border: BorderStyle,
  height: Size,
  width: Size,
  minWidth: Size,
  minHeight: Size,
  fillWidth: bool,
  fillHeight: bool,
});

type EnumVariants<T> = { [K in keyof T]: { tag: K; value: T[K] } }[keyof T];

const Children = lazy(() => CustomRendererNode);

type ComponentType<Props extends Codec<any>> = CodecType<ReturnType<typeof Component<Props>>>;
function Component<Props extends Codec<any>>(props: Props) {
  return Struct({
    modifiers: Vector(Modifier),
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
  text: str,
  variant: Option(ButtonVariant),
  enabled: OptionBool,
  loading: OptionBool,
  clickAction: Option(str),
});

export const TextFieldProps = Struct({
  text: str,
  placeholder: Option(str),
  label: Option(str),
  enabled: OptionBool,
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
