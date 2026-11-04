import { curve, getMeshPosition } from "@kokoro/rig";

const headWeight = (fromTop: number) => 0.4 + 0.6 * fromTop;

export const BASE_POSE = {
	default: () => {
		return { tx: 0, ty: 0 };
	},
};

export const HEAD_POSE = (scale: number = 1) => ({
	headLeft: (u: number, v: number) => {
		const { fromTop } = getMeshPosition(u, v);
		const w = headWeight(fromTop);

		return {
			tx: -100 * w * scale,
			ty: 0,
		};
	},

	headRight: (u: number, v: number) => {
		const { fromTop } = getMeshPosition(u, v);
		const w = headWeight(fromTop);

		return {
			tx: 100 * w * scale,
			ty: 0,
		};
	},

	headUp: (u: number, v: number) => {
		const { fromTop } = getMeshPosition(u, v);
		const w = headWeight(fromTop);

		return {
			tx: 0,
			ty: -100 * w * scale,
		};
	},

	headDown: (u: number, v: number) => {
		const { fromTop } = getMeshPosition(u, v);
		const w = headWeight(fromTop);

		return {
			tx: 0,
			ty: 100 * w * scale,
		};
	},
});

export const PART_SHIFT = {
	shiftLeft: () => {
		return { tx: -20, ty: 0 };
	},
	shiftRight: () => {
		return { tx: 20, ty: 0 };
	},
	shiftUp: () => {
		return { tx: 0, ty: -20 };
	},
	shiftDown: () => {
		return { tx: 0, ty: 20 };
	},
};

export const HAIR_SWING = {
	swingLeft: (u: number, v: number) => {
		const { fromBottom } = getMeshPosition(u, v);

		return {
			tx: 0,
			ty: 0,
			rot: 0.12 * curve.power2(fromBottom),
			pivot: { u: 0.5, v: 0.0 },
		};
	},
	swingRight: (u: number, v: number) => {
		const { fromBottom } = getMeshPosition(u, v);

		return {
			tx: 0,
			ty: 0,
			rot: -0.12 * curve.power2(fromBottom),
			pivot: { u: 0.5, v: 0.0 },
		};
	},
};

export const BROW_ROLL = {
	rollLeftDown: () => {
		return { tx: 0, ty: 0, rot: -0.25, pivot: { u: 0.5, v: 0.5 } };
	},
	rollRightDown: () => {
		return { tx: 0, ty: 0, rot: 0.25, pivot: { u: 0.5, v: 0.5 } };
	},
};
