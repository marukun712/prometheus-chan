import { curve, type Pose, type Rig } from "@kokoro/rig";

export const makeTemplate = (rig: Rig): Record<string, Pose> => {
	const A = rig.h * 0.25;
	const R = 0.5;

	return {
		neutral: () => ({ tx: 0, ty: 0 }),
		shiftX: () => ({ tx: A, ty: 0 }),
		shiftY: () => ({ tx: 0, ty: A }),
		bendX: (_, v) => ({ tx: A * curve.power2(1 - v), ty: 0 }),
		bendY: (_, v) => ({ tx: 0, ty: A * curve.power2(1 - v) }),
		tilt: () => ({ tx: 0, ty: 0, rot: R, pivot: { u: 0.5, v: 1 } }),
		swing: (_, v) => ({
			tx: 0,
			ty: 0,
			rot: R * curve.power2(v),
			pivot: { u: 0.5, v: 0 },
		}),
	};
};
