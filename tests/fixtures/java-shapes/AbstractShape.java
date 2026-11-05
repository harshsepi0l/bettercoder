public abstract class AbstractShape implements Shape {
    protected String label;

    public AbstractShape(String label) {
        this.label = label;
    }

    public String name() {
        return label;
    }
}
