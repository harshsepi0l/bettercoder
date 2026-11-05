public class Circle extends AbstractShape {
    private double radius;

    public Circle(double radius) {
        super("circle");
        this.radius = radius;
    }

    @Override
    public double area() {
        // TODO: use Math.PI
        return 0;
    }
}
