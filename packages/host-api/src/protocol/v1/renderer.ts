import { Bytes, Enum, OptionBool, Status, lazy } from '@novasamatech/scale';
import type { Codec, CodecType } from 'scale-ts';
import { Option, Struct, Tuple, Vector, _void, bool, compact, str, u8 } from 'scale-ts';

import { GenericError } from '../commonCodecs.js';

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
  Square: _void,
});

export const BorderStyle = Struct({
  width: Size,
  color: ColorToken,
  shape: Option(Shape),
});

/** How a node composites with what is behind it (CSS `mix-blend-mode` values). */
export const BlendingMode = Status(
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
);

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
  /** 0 is transparent, 255 is opaque. */
  opacity: u8,
  blendingMode: BlendingMode,
});

type EnumVariants<T> = { [K in keyof T]: { tag: K; value: T[K] } }[keyof T];

const Children = lazy(() => RendererNode);

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

/** Where image bytes come from. The host fetches them; the tree carries no URL. */
export const ImageSource = Enum({
  /** A Bulletin chain blob, addressed by its CID. */
  Bulletin: str,
  /** A file inside the product's executable archive, relative to the archive root. */
  Archive: str,
});

export const ImageFit = Status('none', 'fill', 'cover', 'contain', 'scaleDown');

export const ImageProps = Struct({
  source: ImageSource,
  /** Defaults to `fill`. */
  fit: Option(ImageFit),
});

export const Effect = Status('rainbow');

export const EffectProps = Struct({
  effect: Effect,
});

export const TextFieldProps = Struct({
  text: str,
  placeholder: Option(str),
  label: Option(str),
  enabled: OptionBool,
  valueChangeAction: Option(str),
});

const Modifiers = Vector(Modifier);

export type RendererNodeType = EnumVariants<{
  Nil: undefined;
  String: string;
  Box: ComponentType<typeof BoxProps>;
  Column: ComponentType<typeof ColumnProps>;
  Row: ComponentType<typeof RowProps>;
  Spacer: { modifiers: CodecType<typeof Modifiers> };
  Text: ComponentType<typeof TextProps>;
  Button: ComponentType<typeof ButtonProps>;
  TextField: { modifiers: CodecType<typeof Modifiers>; props: CodecType<typeof TextFieldProps> };
  Image: { modifiers: CodecType<typeof Modifiers>; props: CodecType<typeof ImageProps> };
  Effect: { props: CodecType<typeof EffectProps>; children: RendererNodeType[] };
}>;

/** A node in a product-rendered tree. Container variants recurse through `children`. */
export const RendererNode: Codec<RendererNodeType> = Enum({
  Nil: _void,
  String: str,
  Box: Component(BoxProps),
  Column: Component(ColumnProps),
  Row: Component(RowProps),
  Spacer: Struct({ modifiers: Modifiers }),
  Text: Component(TextProps),
  Button: Component(ButtonProps),
  TextField: Struct({ modifiers: Modifiers, props: TextFieldProps }),
  Image: Struct({ modifiers: Modifiers, props: ImageProps }),
  Effect: Struct({ props: EffectProps, children: Vector(Children) }),
});

/** Where a product-rendered body lives, and the id that names it there. */
export const RenderContext = Enum({
  /** A message in a chat room; `messageType` is the product-defined discriminator. */
  ChatMessage: Struct({ roomId: str, messageId: str, messageType: str }),
  /** A candidate answered to an input query. */
  InputWidget: Struct({ candidateId: str }),
  /** A card face in the host's Pocket collection. */
  PocketCard: Struct({ cardId: str }),
});

// renderer.render — host-initiated: the host starts it, the product streams trees.

export const RendererRenderV1_start = Struct({
  context: RenderContext,
  /** Product-defined payload, opaque to the host. */
  payload: Bytes(),
});
export const RendererRenderV1_receive: Codec<RendererNodeType> = RendererNode;
export const RendererRenderV1_interrupt = GenericError;

// renderer.actionSubscribe — actions triggered inside product-rendered bodies.

export const RendererAction = Struct({
  context: RenderContext,
  /** Which action was triggered, as named in the renderer tree. */
  actionId: str,
  /**
   * Data the node attached: empty for a `Button` press, the UTF-8 bytes of the
   * new value (no length prefix) for a `TextField` change.
   */
  payload: Bytes(),
});

export const RendererActionSubscribeV1_start = _void;
export const RendererActionSubscribeV1_receive = RendererAction;
export const RendererActionSubscribeV1_interrupt = GenericError;
