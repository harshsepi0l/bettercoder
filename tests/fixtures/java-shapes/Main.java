import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(2));
        for (Shape s : shapes) {
            System.out.println(s.name() + " " + s.area());
        }
    }
}
