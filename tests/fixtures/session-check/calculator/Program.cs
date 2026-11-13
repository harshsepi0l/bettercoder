Console.WriteLine("What is your first number?");
string s = Console.ReadLine() ?? " ";
int number;

bool success = int.TryParse(s, out number);

Console.WriteLine("What is your second number?");
string t = Console.ReadLine() ?? " ";
int SecNumber = Int32.Parse(t);
Console.WriteLine("Which operation would you like to do?");
string w = Console.ReadLine() ?? " ";
if (w == "+")
{
    int result = number + SecNumber;
    Console.WriteLine(result);
}
else if (w == "-")
{
    int result = number - SecNumber;
    Console.Write(result);
}
else if (w == "*")
{
    int result = number * SecNumber;
    Console.Write(result);
}
else if (w == "/")
{
    int result = number / SecNumber;
    Console.Write(result);
}
else
{
    Console.WriteLine("I don't know that operation");
}
