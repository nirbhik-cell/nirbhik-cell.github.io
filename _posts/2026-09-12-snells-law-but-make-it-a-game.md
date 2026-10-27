---
title: "Snell's law, but make it a game"
date: 2026-09-12
tags: [optics, code, demos]
summary: "Sample post: refraction in one equation, one function, and one playground you can break."
sample: true
draft: true
---

*This is a sample post that shows what the blog can do: equations, code, a table of contents and an embedded demo. Replace it with your own writing.*

Light changes direction when it crosses from one medium into another. The rule that governs the bend has been around since the seventeenth century and still fits on a sticky note.

## The equation

Snell's law relates the angles of incidence and refraction to the refractive indices of the two media:

\[
n_1 \sin\theta_1 = n_2 \sin\theta_2
\]

Going from air (\( n_1 \approx 1.00 \)) into glass (\( n_2 \approx 1.50 \)) the beam bends *toward* the normal. Going the other way it bends *away*, and past the critical angle

\[
\theta_c = \arcsin\!\left(\frac{n_2}{n_1}\right), \qquad n_1 > n_2,
\]

it does not leave at all. That is total internal reflection, and it is why optical fibre works.

## The same thing in code

A refraction step is a few lines once you work with unit vectors instead of angles:

```python
import math

def refract(direction, normal, n1, n2):
    """Return the refracted unit vector, or None on total internal reflection."""
    cos_i = -sum(d * n for d, n in zip(direction, normal))
    ratio = n1 / n2
    k = 1 - ratio**2 * (1 - cos_i**2)
    if k < 0:
        return None  # total internal reflection
    scale = ratio * cos_i - math.sqrt(k)
    return [ratio * d + scale * n for d, n in zip(direction, normal)]
```

## Try it

The playground below uses mirrors, thin lenses and beam splitters rather than a full refraction model, but the idea is the same: a ray, a surface, a rule. Drag things around until the beam does something you did not expect.

[[demo:optics]]

## Things to try

- Put two mirrors facing each other and watch the depth cap stop the beam.
- Drop a lens in front of a splitter and ask where the two branches meet.
- Nudge the laser angle by one degree and see which parts of the layout care.
