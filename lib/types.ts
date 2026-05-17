export type NodeId = string;

export type ParamValue =
  | number
  | [number, number, number]
  | boolean
  | string;

export type ParamsMap = Record<string, ParamValue>;

export type PrimitiveType =
  | "sphere"
  | "box"
  | "roundBox"
  | "torus"
  | "cappedTorus"
  | "plane"
  | "capsule"
  | "cylinder"
  | "cone"
  | "hexPrism"
  | "triPrism"
  | "ellipsoid"
  | "octahedron"
  | "pyramid"
  | "link"
  | "mandelbulb"
  | "mandelbox"
  | "mengerSponge"
  | "sierpinski";

export type BooleanType =
  | "union"
  | "intersection"
  | "subtract"
  | "smoothUnion"
  | "smoothIntersection"
  | "smoothSubtract";

export type TransformType =
  | "translate"
  | "rotateEuler"
  | "scaleUniform"
  | "mirror"
  | "infiniteRepeat"
  | "finiteRepeat"
  | "polarRepeat"
  | "twist"
  | "bend"
  | "displace"
  | "noiseValue"
  | "noiseFbm"
  | "noiseRidged";

export type NodeType = PrimitiveType | BooleanType | TransformType;

export type NodeKind = "primitive" | "boolean" | "transform";

export type BaseNode = {
  id: NodeId;
  enabled: boolean;
  label?: string;
};

export type PrimitiveNode = BaseNode & {
  kind: "primitive";
  type: PrimitiveType;
  params: ParamsMap;
  matId?: number; // material slot, default 0
};

export type BooleanNode = BaseNode & {
  kind: "boolean";
  type: BooleanType;
  params: ParamsMap;
  children: SdfNode[];
};

export type TransformNode = BaseNode & {
  kind: "transform";
  type: TransformType;
  params: ParamsMap;
  child: SdfNode | null;
};

export type SdfNode = PrimitiveNode | BooleanNode | TransformNode;

export type ParamSpec =
  | {
      key: string;
      label: string;
      type: "float";
      default: number;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      key: string;
      label: string;
      type: "vec3";
      default: [number, number, number];
      step?: number;
    }
  | {
      key: string;
      label: string;
      type: "bool";
      default: boolean;
    }
  | {
      key: string;
      label: string;
      type: "int";
      default: number;
      min?: number;
      max?: number;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      default: string;
    };

export type NodeSpec = {
  type: NodeType;
  kind: NodeKind;
  category: string;
  label: string;
  params: ParamSpec[];
};
