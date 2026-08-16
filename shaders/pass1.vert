varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vPosition;
varying vec3 vDisplacedPosition; // Kept for fragment pipeline derivative calculations

void main() {
    vUV = uv;
    vNormal = normalMatrix * normal;
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vDisplacedPosition = position; // Raw surface position passed to fragment shader

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}