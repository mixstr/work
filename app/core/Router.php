<?php 

namespace app\core;

use app\controller\CoefficientController;
use app\controller\MonthController;
use app\controller\EmployeeController;

class Router{

    public $act;
    public $method;

    public function __construct(){
        $this->act = $_REQUEST["act"];
        $this->method = $_REQUEST["method"];
        $this->validAct();
    }

    public function validAct(){
        switch($this->act){
            case "month":
                $this->monthMethod();
                break;
            case "employee":
                $this->employeeMethod();
                break;
            case "coefficient":
                $this->coefficientMethod();
                break;
            default:
                echo "Invalid act";
        }
    }

    public function monthMethod(){
        $month = new MonthController;
        switch($this->method){
            case "selectAll":
                $month->selectAll();
                break;
            case "selectById":
                $id = $_REQUEST["id"];
                $month->selectById($id);
                break;
            case "selectByDay":
                $day = $_REQUEST["day"];
                $month->selectByDay($day);
                break;
            case "selectByName":
                $name = $_REQUEST["name"];
                $month->selectByName($name);
                break;
            case "selectByMonth":
                $monthID = $_REQUEST["month"];
                $month->selectByMonth($monthID);
                break;
            case "selectByYear":
                $year = $_REQUEST["year"];
                $month->selectByYear($year);
                break;
            case "insert":
                $month->insert($_REQUEST);
                break;
            case "update":
                $month->update($_REQUEST);
                break;
            case "delete":
                $month->delete($_REQUEST);
                break;
            default:
                echo "Invalid method for month: " . $this->method;
        }
    }

    public function employeeMethod(){
        $employee = new EmployeeController;
        switch($this->method){
            case "selectAll":
                $employee->selectAll();
                break;
            case "selectById":
                $id = $_REQUEST["id"];
                $employee->selectById($id);
                break;
            case "selectByFio":
                $fio = $_REQUEST["fio"];
                $employee->selectByFio($fio);
                break;
            case "selectByHire":
                $hire_date = $_REQUEST["hire_date"];
                $employee->selectByHire($hire_date);
                break;
            case "selectByTermination":
                $termination_date = $_REQUEST["termination_date"];
                $employee->selectByTermination($termination_date);
                break;
            case "insert":
                $employee->insert($_REQUEST);
                break;
            case "update":
                $employee->update($_REQUEST);
                break;
            case "delete":
                $employee->delete($_REQUEST);
                break;
            default:
                echo "Invalid method for employee: " . $this->method;
        }
    }

    public function coefficientMethod(){
        $coefficient = new CoefficientController;
        switch($this->method){
            case "selectAll":
                $coefficient->selectAll();
                break;
            case "selectById":
                $id =  $_REQUEST["id"]; 
                $coefficient->selectById($id);
                break;
            case "selectByEmployee":
                $employee_id = $_REQUEST["employee"];
                $coefficient->selectByEmployee($employee_id);
                break;
            case "selectByMonth":
                $month_id = $_REQUEST["month"];
                $coefficient->selectByMonth($month_id);
                break;
            case "insert":
                $coefficient->insert($_REQUEST);
                break;
            case "update":
                $coefficient->update($_REQUEST);
                break;
            case "delete":
                $coefficient->delete($_REQUEST);
                break;
            default:
                echo "Invalid method for coefficient: " . $this->method;
        }
    }
}