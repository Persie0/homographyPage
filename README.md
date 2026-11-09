# GroundLab — Homography Studio

Interactive, static GitHub Pages calibration website for [traffic-counting-light-main](https://github.com/Persie0/traffic-counting-light-main).

## Features

- Upload local background.jpg / camera image (PNG, JPEG, WebP or BMP), or use the illustrated demo.
- Move four ground-point handles in the original camera image.
- Enter the measured width and length of the ground rectangle in meters.
- Inspect the warped bird's-eye-view image and 5-meter ground grid.
- Tap two places in the BEV to measure real-world distance.
- Orbit a WebGL 3D scene: metric road plane, approximate camera location, view rays, ground-distance grid and cars.
- Place cars directly on the 3D road or in the BEV. Drag cars on the BEV to update their world positions.
- Adjust the assumed horizontal field of view for the 3D camera reconstruction.
- Save the traffic-counting-compatible matrix, self-contained JSON project, or PNG of the BEV.
- Six-step guided tutorial and geometry warnings.

All images are processed in the browser. There is no server component or image upload. The 3D viewer downloads the Three.js module from jsDelivr; the rest of the application is dependency-free.

## GitHub Pages deployment (without GitHub Actions)

This is a plain static site. No npm build or GitHub Actions workflows are required.

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose **main / (root)** and save.
4. Open **https://persie0.github.io/homographyPage/** after Pages publishes the site.

Local preview:

    python3 -m http.server 8000
    # Visit http://localhost:8000

Dependency-free tests (Node.js 20+):

    npm test

## How calibration works

Choose four points, on one flat ground rectangle, in this order:

    4 far-left ------------ 3 far-right
         |                         |
         |        ROAD             |      far
         |                         |
    1 near-left ----------- 2 near-right
                 near

The rectangle must be real and measurable, not just an arbitrary quadrilateral drawn in the camera picture. Its width is the near-left ↔ near-right distance; its length is the near-left ↔ far-left distance.

The exported homography maps camera pixels (u,v) to metric (X,Y):

    near left   => (-width/2, 0)
    near right  => (+width/2, 0)
    far right   => (+width/2, length)
    far left    => (-width/2, length)

The normalized four-point DLT produces a 3×3 H such that

    [x', y', w'] = H × [u, v, 1]
    (X,Y) = (x'/w', y'/w')

The saved three-row, comma-delimited configuration is compatible with the detector's numpy.loadtxt call and cv2.perspectiveTransform.

## Correct-looking calibration

The bird's-eye road should have straight and parallel ground lane markings where they are actually parallel, and measured distances should match the 5 m grid. The transform is valid *on the road plane only*. Cars, signs, trees, walls and other objects raised above the ground appear stretched or distorted; that is expected.

**Four points exactly fit any invertible 4-point projective mapping.** Zero residual at the four selected corners does not prove that the scale in meters is correct. Validate with an independent ground measurement / fifth landmark and, for speed calculations, an independent speed reference. Avoid slopes, uneven roads, guessed road widths and horizon points.

### Original frame coordinates matter

Use a background image corresponding to the **same camera processing stage and image size** as the frames sent into homography speed measurement. Cropping, mirroring, fisheye dewarping, rotation and resizing change the coordinates. The UI's on-screen image is scaled for display, but the matrix always uses original uploaded pixel coordinates.

### The 3D camera is approximate

The 3D camera is estimated by decomposing the planar homography with an *assumed* pinhole intrinsics matrix: square pixels, center principal point and your chosen horizontal FOV. It is illustrative, not an independent measurement of mounting height, exact tilt or lens distortion. Changing FOV changes this pose but **does not change the image-to-ground homography**.

The displayed cars use approximate 1.82 m × 4.35 m footprints. Cars are placed at world coordinates on the ground and synchronized with the BEV and source image.

## Install in traffic-counting

The detector reads this exact path:

    ~/.config/traffic-counting/homography_matrix_manual.cfg

The corresponding config setting is:

    processing:
      speed_measurement:
        method: "homography_matrix_manual"
        homography_measurement:
          tracking_point: "bottom_center"

Back up the old config file first, install the downloaded matrix and restart the traffic-counting process. The website never writes directly to your Raspberry Pi.

Relevant implementation points reviewed in the source repository:

- traffic-counting-edge-detection-master/src/detection/traffic_detector.py
- traffic-counting-edge-detection-master/src/speed_measurement/homography_matrix.py
- traffic-counting-edge-detection-master/src/speed_measurement/homography_speed_measurement.py
- traffic-counting-edge-dashboard-main/server/api/calibration.py
- traffic-counting-edge-detection-master/src/config-template.yaml

## Project backups and privacy

The downloaded JSON embeds the original image alongside point locations, dimensions, camera-FOV assumption, matrix and car locations. Keep it private if the camera shows sensitive imagery. The JSON can be re-imported for later edits.

## Limitations

- This is a manual *planar* homography, not full camera calibration, lens distortion correction or 3D terrain reconstruction.
- Metric dimensions require actual measurements, surveyed points or reliable external references.
- Objects above the plane are not geometrically rectified.
- Browser WebGL and internet access to the Three.js CDN are needed for the 3D view; the calibration tool and BEV can run without Three.js.
